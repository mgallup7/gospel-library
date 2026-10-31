"""Keep the local library in step with the site.

A sync walks each collection's tables of contents, fetches any page it has not
seen, and re-checks a budgeted number of pages whose turn has come (recent
conference talks are re-read often, old chapters rarely). Everything is
resumable: each page is committed as it lands, so an interrupted run simply
picks up where it stopped the next night.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import re
import time

from . import config, scriptures
from .db import Store, now
from .fetch import FetchError, Fetcher, NotFound
from .parse import ParsedDoc, parse_content
from . import toc as toc_mod
from .toc import Node, Toc

log = logging.getLogger("gospel.sync")

_CONF_URI = re.compile(r"^/general-conference/(\d{4})/(\d{2})(?:/|$)")
MAX_CONSECUTIVE_ERRORS = 25


class Syncer:
    def __init__(self, store: Store, fetcher: Fetcher, *, max_requests: int | None = None, full: bool = False):
        self.store = store
        self.fetcher = fetcher
        self.max_requests = max_requests
        self.full = full
        self.counts = {"added": 0, "changed": 0, "checked": 0, "errors": 0}
        self._consecutive_errors = 0
        self._stopped = False

    # ------------------------------------------------------------------ run --
    def run(self, slugs: list[str] | None = None, *, recheck_budget: int | None = None) -> dict:
        run_id = self.store.start_run()
        started = time.monotonic()
        notes = []
        try:
            for sort, coll in enumerate(config.COLLECTIONS):
                if slugs and coll["slug"] not in slugs:
                    continue
                if self._stopped:
                    break
                log.info("== %s", coll["title"])
                if coll["kind"] == "books":
                    self.sync_books(coll, sort)
                elif coll["kind"] == "conference":
                    self.sync_conference(coll, sort)
            if not self._stopped:
                budget = config.NIGHTLY_RECHECK_BUDGET if recheck_budget is None else recheck_budget
                if budget:
                    self.recheck_due(budget, slugs)
        except KeyboardInterrupt:
            notes.append("interrupted")
            log.warning("interrupted; progress so far is saved")
        finally:
            if self._stopped:
                notes.append("stopped early")
            self.store.finish_run(
                run_id,
                requests=self.fetcher.requests_made,
                notes="; ".join(notes) or None,
                **self.counts,
            )
            if self.counts["added"] or self.counts["changed"]:
                log.info("optimizing search index")
                self.store.optimize()
            self.store.set_meta("last_sync", {"finished": now(), **self.counts, "requests": self.fetcher.requests_made})
            log.info(
                "done in %.0fs: %d added, %d changed, %d checked, %d errors, %d requests",
                time.monotonic() - started, self.counts["added"], self.counts["changed"],
                self.counts["checked"], self.counts["errors"], self.fetcher.requests_made,
            )
        return dict(self.counts)

    # --------------------------------------------------------------- books --
    def sync_books(self, coll: dict, sort: int) -> None:
        cid = self.store.collection_id(coll["slug"], coll["title"], coll["kind"], sort)
        for i, root in enumerate(coll["roots"]):
            if self._stopped:
                return
            nodes, book_id = self._book_nodes(cid, root, sort=i, toc_days=30, missing_days=7)
            if not nodes:
                continue
            self._fetch_new(cid, book_id, nodes)

    # ---------------------------------------------------------- conference --
    def sync_conference(self, coll: dict, sort: int) -> None:
        cid = self.store.collection_id(coll["slug"], coll["title"], coll["kind"], sort)
        today = dt.date.today()
        periods = []
        for year in range(config.FIRST_CONFERENCE_YEAR, today.year + 1):
            for month in (4, 10):
                if (year, month) <= (today.year, today.month):
                    periods.append((year, month))
        for year, month in reversed(periods):  # newest first
            if self._stopped:
                return
            uri = f"/general-conference/{year}/{month:02d}"
            age_days = (today - dt.date(year, month, 1)).days
            recent = age_days < 75
            nodes, book_id = self._book_nodes(
                cid, uri, sort=year * 100 + month,
                toc_days=1 if recent else 120,
                missing_days=1 if recent else 30,
                year=year, month=month,
            )
            if not nodes:
                continue
            # Before a conference's talks are published its sessions are listed
            # as plain pages (video only). They carry no text worth indexing.
            nodes = [n for n in nodes if not (n.kind == "content" and n.uri and n.uri.endswith("-session"))]
            self._fetch_new(cid, book_id, nodes)

    # ------------------------------------------------------------ helpers --
    def _book_nodes(self, cid: int, uri: str, *, sort: int, toc_days: float, missing_days: float,
                    year: int | None = None, month: int | None = None) -> tuple[list[Node], int | None]:
        """Return the content nodes for a book, refreshing its TOC when due."""
        book = self.store.book(uri)
        if book is not None and book["collection_id"] != cid:
            # The root moved to another shelf in config; take the book and its pages along.
            self.store.book_id(cid, uri, book["title"], sort=sort, year=year, month=month)
            book = self.store.book(uri)
        if book is not None and not self.full and book["toc_next_check"] and book["toc_next_check"] > now():
            if book["status"] == "missing":
                return [], book["id"]
            return _nodes_from_json(book["toc_json"]), book["id"]

        toc = self.load_toc(uri)
        if toc is None:
            title = book["title"] if book is not None else uri
            book_id = self.store.book_id(cid, uri, title, sort=sort, year=year, month=month)
            self.store.mark_book_missing(book_id, missing_days)
            log.info("   %s: not available (will look again in %g days)", uri, missing_days)
            return [], book_id

        book_id = self.store.book_id(cid, uri, toc.title or uri, content_type=toc.content_type, sort=sort, year=year, month=month)
        self.store.record_toc(book_id, toc.nodes, next_check_days=toc_days)
        n = len(toc.content_nodes)
        log.info("   %s: %d pages in table of contents", toc.title or uri, n)
        return toc.nodes, book_id

    def load_toc(self, uri: str) -> Toc | None:
        try:
            state = self.fetcher.page_state(uri)
            found = toc_mod.from_state(state, uri)
            if found and found.content_nodes:
                return found
        except NotFound:
            return None
        except FetchError as exc:
            log.warning("   page state unavailable for %s (%s)", uri, exc)
            if self._note_error():
                return None
        try:
            payload = self.fetcher.content(uri)
        except NotFound:
            return None
        except FetchError as exc:
            log.warning("   manifest unavailable for %s (%s)", uri, exc)
            self._note_error()
            return None
        body = (payload.get("content") or {}).get("body") or ""
        title = (payload.get("meta") or {}).get("title") or ""
        found = toc_mod.from_manifest(body, uri, title)
        if found and found.content_nodes:
            return found
        return None

    def _fetch_new(self, cid: int, book_id: int | None, nodes: list[Node]) -> None:
        known = set() if self.full else self.store.known_uris(cid)
        todo = [n for n in nodes if n.kind == "content" and n.uri and n.uri not in known]
        if not todo:
            return
        log.info("   fetching %d new pages", len(todo))
        done = 0
        for node in todo:
            if self._stopped or self._budget_spent():
                return
            try:
                self.fetch_one(node.uri, cid=cid, book_id=book_id, node=node)
                self.store.clear_miss(node.uri)
            except NotFound:
                log.info("   not there (yet): %s", node.uri)
                self.store.note_miss(node.uri)
                self._reset_errors()
            except FetchError as exc:
                self.counts["errors"] += 1
                log.warning("   failed %s: %s", node.uri, exc)
                if self._note_error():
                    return
            except Exception:  # noqa: BLE001 - one bad page must not stop the night
                self.counts["errors"] += 1
                log.exception("   could not process %s", node.uri)
                if self._note_error():
                    return
            done += 1
            if done % 25 == 0:
                log.info("   ... %d/%d (%d added, %d changed, %d requests)", done, len(todo),
                         self.counts["added"], self.counts["changed"], self.fetcher.requests_made)

    def fetch_one(self, uri: str, *, cid: int, book_id: int | None, node: Node | None, use_cache: bool = False) -> str:
        payload = self.fetcher.content(uri, use_cache=use_cache)
        parsed = parse_content(payload, uri)
        extra = context_for(uri, node=node, book=self.store.book_row(book_id) if book_id else None)
        if not parsed.paragraphs:
            log.warning("   no text found in %s (%s)", uri, parsed.content_type)
        _, outcome = self.store.save_document(collection_id=cid, book_id=book_id, doc=parsed, node=node, extra=extra)
        self.counts["checked" if outcome == "unchanged" else outcome] += 1
        self._reset_errors()
        return outcome

    def recheck_due(self, budget: int, slugs: list[str] | None = None) -> None:
        due = self.store.due_documents(budget)
        if slugs:
            due = [d for d in due if d["collection"] in slugs]
        if not due:
            return
        log.info("== re-checking %d pages whose turn has come", len(due))
        for row in due:
            if self._stopped or self._budget_spent():
                return
            try:
                book = self.store.book_row(row["book_id"]) if row["book_id"] else None
                node = _node_for(book, row["uri"]) if book else None
                self.fetch_one(row["uri"], cid=row["collection_id"], book_id=row["book_id"], node=node)
            except NotFound:
                log.info("   gone from the site: %s", row["uri"])
                self.store.defer_document(row["id"], 365, status="gone")
            except FetchError as exc:
                self.counts["errors"] += 1
                log.warning("   failed %s: %s", row["uri"], exc)
                self.store.defer_document(row["id"], 3)
                if self._note_error():
                    return
            except Exception:  # noqa: BLE001
                self.counts["errors"] += 1
                log.exception("   could not process %s", row["uri"])
                self.store.defer_document(row["id"], 7)

    def rebuild(self, slugs: list[str] | None = None) -> None:
        """Re-parse every cached page without touching the network."""
        uris = self.fetcher.cache.uris("content")
        log.info("re-parsing %d cached pages", len(uris))
        conn = self.store.conn
        cols = {c["slug"]: c for c in config.COLLECTIONS}
        for i, uri in enumerate(uris, 1):
            row = conn.execute(
                "SELECT d.collection_id, d.book_id, c.slug FROM documents d JOIN collections c ON c.id=d.collection_id WHERE d.uri=?",
                (uri,),
            ).fetchone()
            if row is None:
                continue
            if slugs and row["slug"] not in slugs:
                continue
            book = self.store.book_row(row["book_id"]) if row["book_id"] else None
            node = _node_for(book, uri) if book else None
            try:
                self.fetch_one(uri, cid=row["collection_id"], book_id=row["book_id"], node=node, use_cache=True)
            except Exception:  # noqa: BLE001
                log.exception("   could not re-parse %s", uri)
            if i % 500 == 0:
                log.info("   ... %d/%d", i, len(uris))
        self.store.optimize()

    # -- error accounting ------------------------------------------------------
    def _note_error(self) -> bool:
        self._consecutive_errors += 1
        if self._consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
            log.error("%d failures in a row; the site or the network is unhappy. Stopping for tonight.",
                      self._consecutive_errors)
            self._stopped = True
        return self._stopped

    def _reset_errors(self) -> None:
        self._consecutive_errors = 0

    def _budget_spent(self) -> bool:
        if self.max_requests is not None and self.fetcher.requests_made >= self.max_requests:
            log.info("request budget (%d) reached", self.max_requests)
            self._stopped = True
        return self._stopped


# ---------------------------------------------------------------------------

def context_for(uri: str, *, node: Node | None, book=None) -> dict:
    """What the table of contents and the URI tell us about a page."""
    extra: dict = {}
    m = _CONF_URI.match(uri)
    if m:
        year, month = int(m.group(1)), int(m.group(2))
        extra.update(year=year, month=month, date=f"{year}-{month:02d}-01", subtitle_is_author=True)
        if node is not None:
            path = node.section_path
            if path:
                extra["session"] = path[-1]
            extra["sort_key"] = year * 10000 + month * 100 + min(node.order, 99)
    found = scriptures.book_for_uri(uri)
    if found:
        b, chapter = found
        extra.update(volume=b.volume_name, book_slug=b.slug, book_name=b.name, chapter=chapter)
        if chapter and str(chapter).isdigit():
            extra["title"] = b.citation(int(chapter))  # "Alma 32", whatever the page's own heading says
        key = scriptures.sort_key(uri)
        if key is not None:
            extra["sort_key"] = key
    elif node is not None and "sort_key" not in extra:
        extra["sort_key"] = (book["sort"] if book is not None else 0) * 100000 + node.order
    if book is not None and book["year"] and "year" not in extra:
        extra.update(year=book["year"], month=book["month"])
    return extra


def _nodes_from_json(raw: str | None) -> list[Node]:
    if not raw:
        return []
    data = json.loads(raw)
    nodes: list[Node] = []
    for d in data:
        parent = None
        if d.get("path"):
            parent = Node(kind="section", uri=None, title=d["path"][-1])
            chain = parent
            for title in reversed(d["path"][:-1]):
                chain.parent = Node(kind="section", uri=None, title=title)
                chain = chain.parent
        nodes.append(Node(kind=d["kind"], uri=d.get("uri"), title=d.get("title") or "", subtitle=d.get("subtitle"),
                          depth=d.get("depth", 0), order=d.get("order", 0), parent=parent))
    return nodes


def _node_for(book, uri: str) -> Node | None:
    if book is None or not book["toc_json"]:
        return None
    for n in _nodes_from_json(book["toc_json"]):
        if n.uri == uri:
            return n
    return None
