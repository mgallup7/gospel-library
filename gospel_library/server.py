"""A small HTTP server: the web app plus a JSON API over the local database.

Standard library only, so there is nothing to break on the machine that runs
it. One read-only SQLite connection per thread; the nightly sync writes to the
same file through WAL, so searching keeps working while it runs.
"""

from __future__ import annotations

import gzip
import json
import logging
import mimetypes
import sqlite3
import threading
import time
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import config, db, scriptures, search

log = logging.getLogger("gospel.server")
_local = threading.local()

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")


def _conn() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = db.connect(config.DB_PATH, readonly=True)
        _local.conn = conn
    return conn


class Handler(BaseHTTPRequestHandler):
    server_version = "GospelLibrary/1.0"
    protocol_version = "HTTP/1.1"

    # -- plumbing ---------------------------------------------------------------
    def log_message(self, fmt, *args):  # quieter than the default
        if self.path.startswith("/api/"):
            log.debug("%s %s", self.command, self.path)

    def _send(self, status: int, body: bytes, content_type: str, *, cache: str = "no-store") -> None:
        accepts_gzip = "gzip" in (self.headers.get("Accept-Encoding") or "")
        if accepts_gzip and len(body) > 1024 and not content_type.startswith("image/"):
            body = gzip.compress(body, 5)
            encoding = "gzip"
        else:
            encoding = None
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        if encoding:
            self.send_header("Content-Encoding", encoding)
            self.send_header("Vary", "Accept-Encoding")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, data, status: int = 200) -> None:
        self._send(status, json.dumps(data, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def _error(self, status: int, message: str) -> None:
        self._json({"error": message}, status)

    # -- routing ----------------------------------------------------------------
    def do_HEAD(self):  # noqa: N802
        self.do_GET()

    def do_GET(self):  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        params = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}
        try:
            if path.startswith("/api/"):
                self._api(path[5:], params)
            else:
                self._static(path)
        except BrokenPipeError:
            pass
        except Exception as exc:  # noqa: BLE001
            log.exception("request failed: %s", self.path)
            try:
                self._error(500, f"{type(exc).__name__}: {exc}")
            except Exception:  # noqa: BLE001
                pass

    # -- static files -----------------------------------------------------------
    def _static(self, path: str) -> None:
        if path in ("", "/", "/index.html") or path.startswith("/read/") or path.startswith("/search"):
            path = "/index.html"
        safe = Path(urllib.parse.unquote(path)).as_posix().lstrip("/")
        target = (config.WEB_DIR / safe).resolve()
        if not str(target).startswith(str(config.WEB_DIR.resolve())) or not target.is_file():
            self._error(404, "not found")
            return
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json", "application/manifest+json", "image/svg+xml"):
            ctype += "; charset=utf-8"
        cache = "no-cache" if target.suffix in (".html", ".js", ".css", ".webmanifest") else "public, max-age=86400"
        self._send(200, target.read_bytes(), ctype, cache=cache)

    # -- api --------------------------------------------------------------------
    def _api(self, route: str, p: dict) -> None:
        conn = _conn()
        t0 = time.monotonic()
        if route == "search":
            q = (p.get("q") or "").strip()
            if len(q) < 2:
                self._json({"query": q, "hits": [], "total": 0, "documents": [], "titles": [], "jump": None})
                return
            data = search.search(
                conn, q,
                scope=p.get("scope") or None,
                typeahead=p.get("typeahead") in ("1", "true"),
                limit=min(int(p.get("limit") or 40), 200),
                offset=int(p.get("offset") or 0),
                speaker=p.get("speaker") or None,
                year_from=int(p["from"]) if p.get("from") else None,
                year_to=int(p["to"]) if p.get("to") else None,
                book=p.get("book") or None,
                group=p.get("group") or "passages",
            )
            data["ms"] = round((time.monotonic() - t0) * 1000, 1)
            self._json(data)
        elif route == "doc":
            doc = None
            if p.get("id"):
                doc = search.document(conn, doc_id=int(p["id"]))
            elif p.get("uri"):
                doc = search.document(conn, uri=p["uri"])
            if doc is None:
                self._error(404, "no such document")
            else:
                self._json(doc)
        elif route == "resolve":
            href = p.get("href") or ""
            found = search.resolve(conn, href)
            if found is None:
                self._json({"found": False, "href": href})
            else:
                self._json({"found": True, **found})
        elif route == "stats":
            data = db.stats(conn)
            meta = conn.execute("SELECT key, value FROM meta").fetchall()
            data["meta"] = {r["key"]: json.loads(r["value"]) for r in meta}
            self._json(data)
        elif route == "speakers":
            self._json(search.speakers(conn, p.get("q") or None))
        elif route == "browse":
            self._json(_browse(conn, p.get("collection")))
        elif route == "book":
            self._json(_book(conn, uri=p.get("uri"), book_id=int(p["id"]) if p.get("id") else None))
        elif route == "recent":
            self._json(_recent(conn))
        elif route == "scriptures":
            self._json(_scripture_shelf(conn))
        else:
            self._error(404, "unknown api route")


# ---------------------------------------------------------------------------

def _browse(conn: sqlite3.Connection, slug: str | None) -> dict:
    if not slug:
        rows = conn.execute(
            """SELECT c.slug, c.title, c.kind, COUNT(d.id) AS docs FROM collections c
               LEFT JOIN documents d ON d.collection_id=c.id GROUP BY c.id ORDER BY c.sort"""
        ).fetchall()
        return {"collections": [dict(r) for r in rows]}
    rows = conn.execute(
        """SELECT b.id, b.uri, b.title, b.year, b.month, b.entry_count, b.status, b.sort,
                  (SELECT COUNT(*) FROM documents d WHERE d.book_id=b.id) AS docs
             FROM books b JOIN collections c ON c.id=b.collection_id
            WHERE c.slug=? ORDER BY b.sort DESC, b.id""" if slug == "general-conference" else
        """SELECT b.id, b.uri, b.title, b.year, b.month, b.entry_count, b.status, b.sort,
                  (SELECT COUNT(*) FROM documents d WHERE d.book_id=b.id) AS docs
             FROM books b JOIN collections c ON c.id=b.collection_id
            WHERE c.slug=? ORDER BY b.sort, b.id""",
        (slug,),
    ).fetchall()
    return {"collection": slug, "books": [dict(r) for r in rows]}


def _book(conn: sqlite3.Connection, *, uri: str | None, book_id: int | None) -> dict:
    if book_id is not None:
        book = conn.execute("SELECT * FROM books WHERE id=?", (book_id,)).fetchone()
    else:
        from .fetch import normalize_uri
        book = conn.execute("SELECT * FROM books WHERE uri=?", (normalize_uri(uri or ""),)).fetchone()
    if book is None:
        return {"error": "no such book"}
    docs = {r["uri"]: r for r in conn.execute(
        "SELECT id, uri, title, author, word_count FROM documents WHERE book_id=?", (book["id"],)
    ).fetchall()}
    nodes = json.loads(book["toc_json"] or "[]")
    for n in nodes:
        d = docs.get(n.get("uri"))
        n["doc_id"] = d["id"] if d else None
        if d and not n.get("subtitle") and d["author"]:
            n["subtitle"] = d["author"]
    return {"id": book["id"], "uri": book["uri"], "title": book["title"], "year": book["year"],
            "month": book["month"], "nodes": nodes, "status": book["status"]}


def _recent(conn: sqlite3.Connection) -> dict:
    latest = conn.execute(
        """SELECT b.id, b.uri, b.title, b.year, b.month FROM books b JOIN collections c ON c.id=b.collection_id
            WHERE c.slug='general-conference' AND b.status='ok'
              AND EXISTS (SELECT 1 FROM documents d WHERE d.book_id=b.id)
            ORDER BY b.year DESC, b.month DESC LIMIT 1"""
    ).fetchone()
    if latest is None:
        return {"conference": None, "talks": []}
    talks = conn.execute(
        """SELECT id, uri, title, author, author_role, session, description FROM documents
            WHERE book_id=? ORDER BY sort_key, id""", (latest["id"],)
    ).fetchall()
    return {"conference": dict(latest), "talks": [dict(t) for t in talks]}


def _scripture_shelf(conn: sqlite3.Connection) -> dict:
    """Volumes, books and chapters with the id of each chapter we have."""
    have = {r["uri"]: r["id"] for r in conn.execute(
        "SELECT d.uri, d.id FROM documents d JOIN collections c ON c.id=d.collection_id WHERE c.slug='scriptures'"
    ).fetchall()}
    volumes: dict[str, dict] = {}
    for b in scriptures.books():
        vol = volumes.setdefault(b.volume_slug, {"slug": b.volume_slug, "name": b.volume_name, "books": []})
        chapters = [{"n": c, "uri": f"{b.uri}/{c}", "doc_id": have.get(f"{b.uri}/{c}")} for c in b.chapters]
        vol["books"].append({"slug": b.slug, "name": b.name, "abbrev": b.abbrev, "uri": b.uri,
                             "group": b.group, "chapters": chapters})
    return {"volumes": list(volumes.values()), "have": len(have)}


# ---------------------------------------------------------------------------

def serve(host: str = config.SERVER_HOST, port: int = config.SERVER_PORT) -> None:
    config.ensure_dirs()
    db.connect(config.DB_PATH).close()  # make sure the schema exists before read-only connections open
    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.daemon_threads = True
    log.info("serving on http://%s:%d  (web app in %s)", host, port, config.WEB_DIR)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
