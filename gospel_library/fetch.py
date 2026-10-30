"""Polite HTTP access to ChurchofJesusChrist.org.

Two kinds of request, both throttled through one clock:

* ``content(uri)``   the study content API, which returns ``{meta, content:
                     {head, body, footnotes}}`` for a single page. Light and
                     clean. Falls back to the HTML page when the API is
                     unavailable or disallowed by robots.txt.
* ``page_state(uri)`` the HTML page, from which the embedded application state
                     (``window.__INITIAL_STATE__``) is decoded. This is where a
                     book's full table of contents lives (``reader.bookStore``)
                     and where library listings live (``library``).

Every successful response is also written to a raw cache (``raw.sqlite``) so
the parser can be improved and re-run without touching the network.
"""

from __future__ import annotations

import base64
import gzip
import json
import logging
import re
import sqlite3
import threading
import time
import urllib.parse
import urllib.robotparser
from datetime import datetime, timezone
from pathlib import Path

import requests

from . import config

log = logging.getLogger("gospel.fetch")

_STATE_B64 = re.compile(r'window\.__INITIAL_STATE__\s*=\s*"([^"]+)"')
_STATE_RAW = re.compile(r"window\.__INITIAL_STATE__\s*=\s*(\{.*?\})\s*;?\s*</script>", re.S)


class FetchError(Exception):
    pass


class NotFound(FetchError):
    pass


class RawCache:
    """Compressed copies of every page we have ever fetched, keyed by kind+uri."""

    def __init__(self, path: Path = config.RAW_DB_PATH):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute(
            """CREATE TABLE IF NOT EXISTS raw_pages(
                 kind TEXT NOT NULL,
                 uri TEXT NOT NULL,
                 fetched_at TEXT NOT NULL,
                 payload BLOB NOT NULL,
                 PRIMARY KEY (kind, uri))"""
        )
        self.lock = threading.Lock()

    def put(self, kind: str, uri: str, payload: str) -> None:
        blob = gzip.compress(payload.encode("utf-8"))
        with self.lock, self.conn:
            self.conn.execute(
                "INSERT OR REPLACE INTO raw_pages(kind, uri, fetched_at, payload) VALUES (?,?,?,?)",
                (kind, uri, _now(), blob),
            )

    def get(self, kind: str, uri: str) -> str | None:
        with self.lock:
            row = self.conn.execute(
                "SELECT payload FROM raw_pages WHERE kind=? AND uri=?", (kind, uri)
            ).fetchone()
        return gzip.decompress(row[0]).decode("utf-8") if row else None

    def uris(self, kind: str) -> list[str]:
        with self.lock:
            return [r[0] for r in self.conn.execute("SELECT uri FROM raw_pages WHERE kind=? ORDER BY uri", (kind,))]


class Fetcher:
    def __init__(self, *, offline: bool = False, cache: RawCache | None = None):
        self.offline = offline
        self.cache = cache or RawCache()
        self.session = requests.Session()
        self.session.headers["User-Agent"] = config.USER_AGENT
        self.session.headers["Accept-Language"] = "en-US,en;q=0.9"
        self._clock = threading.Lock()
        self._last = 0.0
        self._robots: urllib.robotparser.RobotFileParser | None = None
        self._robots_loaded = False
        self.requests_made = 0
        self.api_disallowed = False

    # -- throttle -----------------------------------------------------------
    def _wait_turn(self) -> None:
        with self._clock:
            gap = config.MIN_INTERVAL - (time.monotonic() - self._last)
            if gap > 0:
                time.sleep(gap)
            self._last = time.monotonic()

    # -- robots.txt ---------------------------------------------------------
    def _allowed(self, url: str) -> bool:
        if not self._robots_loaded:
            self._robots_loaded = True
            rp = urllib.robotparser.RobotFileParser()
            try:
                self._wait_turn()
                r = self.session.get(f"{config.HOST}/robots.txt", timeout=config.TIMEOUT)
                self.requests_made += 1
                if r.status_code == 200:
                    rp.parse(r.text.splitlines())
                    self._robots = rp
                    log.debug("robots.txt loaded (%d bytes)", len(r.text))
            except requests.RequestException as exc:  # pragma: no cover - network
                log.warning("Could not read robots.txt (%s); proceeding carefully", exc)
        if self._robots is None:
            return True
        return self._robots.can_fetch(config.USER_AGENT, url)

    # -- low level GET with retries -----------------------------------------
    def _get(self, url: str) -> requests.Response:
        if self.offline:
            raise FetchError(f"offline: {url}")
        if not self._allowed(url):
            raise FetchError(f"robots.txt disallows {url}")
        delay = 2.0
        for attempt in range(1, config.MAX_ATTEMPTS + 1):
            self._wait_turn()
            try:
                r = self.session.get(url, timeout=config.TIMEOUT)
            except requests.RequestException as exc:
                if attempt == config.MAX_ATTEMPTS:
                    raise FetchError(f"{url}: {exc}") from exc
                log.warning("network error on %s (%s); retry %d", url, exc, attempt)
                time.sleep(delay)
                delay *= 2
                continue
            self.requests_made += 1
            if r.status_code == 200:
                return r
            if r.status_code in (404, 410):
                raise NotFound(url)
            if r.status_code in (429, 500, 502, 503, 504) and attempt < config.MAX_ATTEMPTS:
                retry_after = r.headers.get("Retry-After")
                wait = float(retry_after) if retry_after and retry_after.isdigit() else delay
                log.warning("HTTP %s on %s; waiting %.0fs", r.status_code, url, wait)
                time.sleep(wait)
                delay *= 2
                continue
            raise FetchError(f"{url}: HTTP {r.status_code}")
        raise FetchError(f"{url}: gave up")  # pragma: no cover

    # -- public API ---------------------------------------------------------
    def content(self, uri: str, *, use_cache: bool = False) -> dict:
        """Return the content-API payload for ``uri`` (site path without /study).

        Raises NotFound for pages that do not exist. With ``use_cache`` the raw
        cache is consulted first (used by ``rebuild``).
        """
        uri = normalize_uri(uri)
        if use_cache or self.offline:
            cached = self.cache.get("content", uri)
            if cached is not None:
                return json.loads(cached)
            if self.offline:
                raise FetchError(f"offline and not cached: {uri}")

        if not self.api_disallowed:
            url = f"{config.CONTENT_API}?{urllib.parse.urlencode({'lang': config.LANG, 'uri': uri})}"
            try:
                r = self._get(url)
                payload = r.json()
                if isinstance(payload, dict) and "content" in payload:
                    self.cache.put("content", uri, r.text)
                    return payload
                log.warning("content API returned an unexpected shape for %s; using the page", uri)
            except NotFound:
                raise
            except FetchError as exc:
                if "robots.txt" in str(exc):
                    log.warning("content API disallowed by robots.txt; using HTML pages instead")
                    self.api_disallowed = True
                else:
                    log.warning("content API failed for %s (%s); trying the page", uri, exc)
            except ValueError:
                log.warning("content API returned non-JSON for %s; trying the page", uri)

        state = self.page_state(uri)
        store = (state.get("reader") or {}).get("contentStore") or {}
        for key, entry in store.items():
            if isinstance(entry, dict) and "content" in entry:
                payload = {"meta": entry.get("meta", {}), "content": entry["content"], "uri": entry.get("uri")}
                self.cache.put("content", uri, json.dumps(payload))
                return payload
        raise FetchError(f"no content found in page state for {uri}")

    def page_state(self, uri: str, *, use_cache: bool = False) -> dict:
        """Decode window.__INITIAL_STATE__ from the HTML page for ``uri``."""
        uri = normalize_uri(uri)
        if use_cache or self.offline:
            cached = self.cache.get("page", uri)
            if cached is not None:
                return decode_state(cached)
            if self.offline:
                raise FetchError(f"offline and not cached: {uri}")
        url = f"{config.HOST}/study{uri}?lang={config.LANG}"
        r = self._get(url)
        state = decode_state(r.text)
        if not state:
            raise FetchError(f"no application state found in {url}")
        # The site answers 200 with a "not found" shell for pages that do not
        # exist; the real status is inside the state.
        status = (state.get("system") or {}).get("status")
        if status in (404, 410):
            raise NotFound(url)
        self.cache.put("page", uri, r.text)
        return state


def decode_state(html: str) -> dict:
    m = _STATE_B64.search(html)
    if m:
        try:
            return json.loads(base64.b64decode(m.group(1)))
        except (ValueError, json.JSONDecodeError):
            pass
    m = _STATE_RAW.search(html)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    return {}


def normalize_uri(uri: str) -> str:
    """Accept any of the site's spellings and return '/scriptures/bofm/alma/32'."""
    uri = uri.strip()
    if uri.startswith("http"):
        uri = urllib.parse.urlparse(uri).path
    uri = uri.split("?")[0].split("#")[0]
    if uri.startswith("/study/"):
        uri = uri[len("/study"):]
    if uri.startswith(f"/{config.LANG}/"):
        uri = uri[len(config.LANG) + 1:]
    if not uri.startswith("/"):
        uri = "/" + uri
    return uri.rstrip("/") or "/"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
