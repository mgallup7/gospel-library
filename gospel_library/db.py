"""SQLite storage: collections, books (tables of contents), documents,
paragraphs, footnotes, and the FTS5 indexes that make search instant."""

from __future__ import annotations

import json
import sqlite3
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import config
from .parse import ParsedDoc
from .toc import Node

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS collections(
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS books(
  id INTEGER PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES collections(id),
  uri TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  content_type TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  year INTEGER,
  month INTEGER,
  entry_count INTEGER NOT NULL DEFAULT 0,
  toc_json TEXT,
  toc_checked_at TEXT,
  toc_next_check TEXT,
  status TEXT NOT NULL DEFAULT 'ok'
);

CREATE TABLE IF NOT EXISTS documents(
  id INTEGER PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES collections(id),
  book_id INTEGER REFERENCES books(id),
  uri TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  author TEXT,
  author_role TEXT,
  kicker TEXT,
  description TEXT,
  date TEXT,
  year INTEGER,
  month INTEGER,
  session TEXT,
  section_path TEXT,
  volume TEXT,
  book_slug TEXT,
  book_name TEXT,
  chapter TEXT,
  content_type TEXT,
  sort_key INTEGER,
  word_count INTEGER NOT NULL DEFAULT 0,
  body_html BLOB,
  par_first INTEGER,
  par_last INTEGER,
  content_hash TEXT,
  fetched_at TEXT,
  first_seen TEXT,
  changed_at TEXT,
  next_check TEXT,
  check_interval INTEGER NOT NULL DEFAULT 7,
  status TEXT NOT NULL DEFAULT 'ok'
);
CREATE INDEX IF NOT EXISTS documents_book ON documents(book_id, sort_key);
CREATE INDEX IF NOT EXISTS documents_author ON documents(author);
CREATE INDEX IF NOT EXISTS documents_coll_year ON documents(collection_id, year, month);
CREATE INDEX IF NOT EXISTS documents_next_check ON documents(next_check);
CREATE INDEX IF NOT EXISTS documents_scripture ON documents(book_slug, chapter);

-- One copy of every paragraph's text, inside the full-text index itself.
-- A document's paragraphs occupy a contiguous rowid range (documents.par_first
-- .. par_last), which is how they are read back in order and removed.
CREATE VIRTUAL TABLE IF NOT EXISTS paragraphs USING fts5(
  text,
  document_id UNINDEXED, seq UNINDEXED, pid UNINDEXED, kind UNINDEXED, verse UNINDEXED,
  tokenize='porter unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  title, author,
  content='documents', content_rowid='id',
  tokenize='porter unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, title, author) VALUES (new.id, new.title, new.author);
END;
CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, author) VALUES ('delete', old.id, old.title, old.author);
END;
CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE OF title, author ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, author) VALUES ('delete', old.id, old.title, old.author);
  INSERT INTO documents_fts(rowid, title, author) VALUES (new.id, new.title, new.author);
END;

CREATE TABLE IF NOT EXISTS footnotes(
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  note_id TEXT NOT NULL,
  marker TEXT,
  pid TEXT,
  html TEXT,
  text TEXT,
  refs TEXT
);
CREATE INDEX IF NOT EXISTS footnotes_doc ON footnotes(document_id);

CREATE TABLE IF NOT EXISTS sync_runs(
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  requests INTEGER NOT NULL DEFAULT 0,
  added INTEGER NOT NULL DEFAULT 0,
  changed INTEGER NOT NULL DEFAULT 0,
  checked INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS misses(
  uri TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  next_try TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
"""


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def in_days(days: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")


def compress_html(html: str | None) -> bytes | None:
    """Reader HTML is stored zlib-compressed; it is read far less often than it is carried around."""
    if not html:
        return None
    return zlib.compress(html.encode("utf-8"), 6)


def decompress_html(blob) -> str:
    if blob is None:
        return ""
    if isinstance(blob, str):  # rows written before compression
        return blob
    return zlib.decompress(blob).decode("utf-8")


def counts(conn: sqlite3.Connection) -> dict:
    """Paragraph and verse counts; a scan, so the result is cached in meta after each sync."""
    paragraphs = conn.execute("SELECT COUNT(*) FROM paragraphs").fetchone()[0]
    verses = conn.execute("SELECT COUNT(*) FROM paragraphs WHERE kind='verse'").fetchone()[0]
    return {"paragraphs": paragraphs, "verses": verses}


def connect(path: Path = config.DB_PATH, *, readonly: bool = False) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    if readonly:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, check_same_thread=False, timeout=30)
    else:
        conn = sqlite3.connect(path, check_same_thread=False, timeout=60)
        conn.executescript(SCHEMA)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


class Store:
    """Write side of the database, used by sync and the seed importer."""

    def __init__(self, path: Path = config.DB_PATH):
        self.conn = connect(path)

    # -- collections / books --------------------------------------------------
    def collection_id(self, slug: str, title: str, kind: str, sort: int) -> int:
        self.conn.execute(
            """INSERT INTO collections(slug, title, kind, sort) VALUES (?,?,?,?)
               ON CONFLICT(slug) DO UPDATE SET title=excluded.title, kind=excluded.kind, sort=excluded.sort""",
            (slug, title, kind, sort),
        )
        self.conn.commit()
        return self.conn.execute("SELECT id FROM collections WHERE slug=?", (slug,)).fetchone()[0]

    def book_id(self, collection_id: int, uri: str, title: str, *, content_type: str | None = None,
                sort: int = 0, year: int | None = None, month: int | None = None) -> int:
        self.conn.execute(
            """INSERT INTO books(collection_id, uri, title, content_type, sort, year, month)
               VALUES (?,?,?,?,?,?,?)
               ON CONFLICT(uri) DO UPDATE SET title=excluded.title, sort=excluded.sort,
                 collection_id=excluded.collection_id,
                 content_type=COALESCE(excluded.content_type, books.content_type),
                 year=COALESCE(excluded.year, books.year), month=COALESCE(excluded.month, books.month)""",
            (collection_id, uri, title, content_type, sort, year, month),
        )
        book_id = self.conn.execute("SELECT id FROM books WHERE uri=?", (uri,)).fetchone()[0]
        # A root that moved to another collection (Preach My Gospel got its own
        # shelf) takes the pages already fetched under it along, no refetch.
        self.conn.execute("UPDATE documents SET collection_id=? WHERE book_id=? AND collection_id!=?", (collection_id, book_id, collection_id))
        self.conn.commit()
        return book_id

    def book(self, uri: str) -> sqlite3.Row | None:
        return self.conn.execute("SELECT * FROM books WHERE uri=?", (uri,)).fetchone()

    def book_row(self, book_id: int | None) -> sqlite3.Row | None:
        if book_id is None:
            return None
        return self.conn.execute("SELECT * FROM books WHERE id=?", (book_id,)).fetchone()

    def record_toc(self, book_id: int, nodes: list[Node], *, next_check_days: float, status: str = "ok") -> None:
        toc = [
            {
                "kind": n.kind, "uri": n.uri, "title": n.title, "subtitle": n.subtitle,
                "depth": n.depth, "order": n.order, "path": n.section_path,
            }
            for n in nodes
        ]
        self.conn.execute(
            """UPDATE books SET entry_count=?, toc_json=?, toc_checked_at=?, toc_next_check=?, status=? WHERE id=?""",
            (sum(1 for n in nodes if n.kind == "content"), json.dumps(toc), now(), in_days(next_check_days), status, book_id),
        )
        self.conn.commit()

    def mark_book_missing(self, book_id: int, next_check_days: float) -> None:
        self.conn.execute(
            "UPDATE books SET status='missing', toc_checked_at=?, toc_next_check=? WHERE id=?",
            (now(), in_days(next_check_days), book_id),
        )
        self.conn.commit()

    # -- documents --------------------------------------------------------------
    def document_state(self, uri: str) -> sqlite3.Row | None:
        return self.conn.execute(
            "SELECT id, content_hash, check_interval, next_check, title FROM documents WHERE uri=?", (uri,)
        ).fetchone()

    def save_document(self, *, collection_id: int, book_id: int | None, doc: ParsedDoc, node: Node | None,
                      extra: dict | None = None) -> tuple[int, str]:
        """Insert or update a document with its paragraphs and footnotes.

        Returns (document_id, outcome) where outcome is 'added', 'changed' or
        'unchanged'.
        """
        extra = extra or {}
        existing = self.document_state(doc.uri)
        ts = now()
        if existing and existing["content_hash"] == doc.content_hash:
            interval = min(max(existing["check_interval"] * 2, config.RECHECK_FIRST_DAYS), config.RECHECK_MAX_DAYS)
            self.conn.execute(
                """UPDATE documents SET fetched_at=?, next_check=?, check_interval=?, status='ok',
                     session=COALESCE(?, session)
                   WHERE id=?""",
                (ts, in_days(interval), interval, extra.get("session"), existing["id"]),
            )
            self.conn.commit()
            return existing["id"], "unchanged"

        title = extra.get("title") or doc.title or (node.title if node else doc.uri)
        # Conference tables of contents give the plain name ("Dallin H. Oaks");
        # the byline adds the title ("President ..."), which lives in author_role.
        toc_author = node.subtitle if node and extra.get("subtitle_is_author") else None
        author = toc_author or doc.author
        fields = {
            "collection_id": collection_id,
            "uri": doc.uri,
            "title": title,
            "subtitle": doc.subtitle,
            "author": author,
            "author_role": doc.author_role,
            "kicker": doc.kicker,
            "description": doc.description,
            "content_type": doc.content_type,
            "word_count": doc.word_count,
            "body_html": compress_html(doc.body_html),
            "content_hash": doc.content_hash,
            "fetched_at": ts,
            "next_check": in_days(config.RECHECK_FIRST_DAYS),
            "check_interval": config.RECHECK_FIRST_DAYS,
            "status": "ok",
        }
        # Context that comes from the table of contents rather than the page
        # itself. Left alone on an update when the caller has nothing new.
        optional = {
            "book_id": book_id,
            "date": doc.date or extra.get("date"),
            "year": extra.get("year"),
            "month": extra.get("month"),
            "session": extra.get("session"),
            "section_path": json.dumps(node.section_path) if node else None,
            "volume": extra.get("volume"),
            "book_slug": extra.get("book_slug"),
            "book_name": extra.get("book_name"),
            "chapter": extra.get("chapter"),
            "sort_key": extra.get("sort_key", node.order if node else None),
        }
        fields.update({k: v for k, v in optional.items() if v is not None})
        with self.conn:
            if existing:
                doc_id = existing["id"]
                sets = ", ".join(f"{k}=?" for k in fields)
                self.conn.execute(f"UPDATE documents SET {sets}, changed_at=? WHERE id=?", (*fields.values(), ts, doc_id))
                self._delete_paragraphs(doc_id)
                self.conn.execute("DELETE FROM footnotes WHERE document_id=?", (doc_id,))
                outcome = "changed"
            else:
                fields["first_seen"] = ts
                cols = ", ".join(fields)
                marks = ", ".join("?" for _ in fields)
                cur = self.conn.execute(f"INSERT INTO documents({cols}) VALUES ({marks})", tuple(fields.values()))
                doc_id = cur.lastrowid
                outcome = "added"
            first = last = None
            for p in doc.paragraphs:
                cur = self.conn.execute(
                    "INSERT INTO paragraphs(text, document_id, seq, pid, kind, verse) VALUES (?,?,?,?,?,?)",
                    (p.text, doc_id, p.seq, p.pid, p.kind, p.verse),
                )
                last = cur.lastrowid
                first = first if first is not None else last
            self.conn.execute("UPDATE documents SET par_first=?, par_last=? WHERE id=?", (first, last, doc_id))
            self.conn.executemany(
                "INSERT INTO footnotes(document_id, note_id, marker, pid, html, text, refs) VALUES (?,?,?,?,?,?,?)",
                [(doc_id, f.note_id, f.marker, f.pid, f.html, f.text, json.dumps(f.refs)) for f in doc.footnotes],
            )
        return doc_id, outcome

    def _delete_paragraphs(self, doc_id: int) -> None:
        row = self.conn.execute("SELECT par_first, par_last FROM documents WHERE id=?", (doc_id,)).fetchone()
        if row and row["par_first"] is not None:
            self.conn.execute("DELETE FROM paragraphs WHERE rowid BETWEEN ? AND ?", (row["par_first"], row["par_last"]))
        else:  # legacy rows without a recorded range
            self.conn.execute("DELETE FROM paragraphs WHERE document_id=?", (doc_id,))

    def defer_document(self, doc_id: int, days: float, status: str = "error") -> None:
        self.conn.execute("UPDATE documents SET next_check=?, status=? WHERE id=?", (in_days(days), status, doc_id))
        self.conn.commit()

    def due_documents(self, limit: int) -> list[sqlite3.Row]:
        return self.conn.execute(
            """SELECT d.id, d.uri, d.collection_id, d.book_id, c.slug AS collection
                 FROM documents d JOIN collections c ON c.id=d.collection_id
                WHERE d.next_check <= ? ORDER BY d.next_check LIMIT ?""",
            (now(), limit),
        ).fetchall()

    def known_uris(self, collection_id: int) -> set[str]:
        """URIs that need no fetch tonight: stored pages (seeded placeholders
        excluded, so the real page replaces them) and recent misses."""
        known = {
            r[0] for r in self.conn.execute(
                "SELECT uri FROM documents WHERE collection_id=? AND COALESCE(content_type, '') != 'seed'",
                (collection_id,),
            )
        }
        known.update(r[0] for r in self.conn.execute("SELECT uri FROM misses WHERE next_try > ?", (now(),)))
        return known

    def note_miss(self, uri: str) -> None:
        row = self.conn.execute("SELECT attempts FROM misses WHERE uri=?", (uri,)).fetchone()
        attempts = (row["attempts"] + 1) if row else 1
        days = min(2 ** (attempts - 1), 60)
        self.conn.execute(
            """INSERT INTO misses(uri, first_seen, last_seen, next_try, attempts) VALUES (?,?,?,?,?)
               ON CONFLICT(uri) DO UPDATE SET last_seen=excluded.last_seen, next_try=excluded.next_try, attempts=excluded.attempts""",
            (uri, now(), now(), in_days(days), attempts),
        )
        self.conn.commit()

    def clear_miss(self, uri: str) -> None:
        self.conn.execute("DELETE FROM misses WHERE uri=?", (uri,))
        self.conn.commit()

    # -- runs / meta -------------------------------------------------------------
    def start_run(self) -> int:
        cur = self.conn.execute("INSERT INTO sync_runs(started_at) VALUES (?)", (now(),))
        self.conn.commit()
        return cur.lastrowid

    def finish_run(self, run_id: int, **counts) -> None:
        notes = counts.pop("notes", None)
        sets = ", ".join(f"{k}=?" for k in counts)
        self.conn.execute(
            f"UPDATE sync_runs SET finished_at=?, notes=?{', ' + sets if sets else ''} WHERE id=?",
            (now(), notes, *counts.values(), run_id),
        )
        self.conn.commit()

    def set_meta(self, key: str, value) -> None:
        self.conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES (?,?)", (key, json.dumps(value)))
        self.conn.commit()

    def get_meta(self, key: str, default=None):
        row = self.conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def optimize(self) -> None:
        self.conn.execute("INSERT INTO paragraphs(paragraphs) VALUES ('optimize')")
        self.conn.execute("INSERT INTO documents_fts(documents_fts) VALUES ('optimize')")
        self.conn.commit()
        self.conn.execute("PRAGMA optimize")
        self.set_meta("counts", counts(self.conn))

    def close(self) -> None:
        self.conn.close()


def stats(conn: sqlite3.Connection) -> dict:
    out = {"collections": [], "documents": 0, "paragraphs": 0, "verses": 0}
    rows = conn.execute(
        """SELECT c.slug, c.title, c.kind, COUNT(d.id) AS docs, COALESCE(SUM(d.word_count), 0) AS words,
                  MAX(d.fetched_at) AS last_fetched
             FROM collections c LEFT JOIN documents d ON d.collection_id=c.id
            GROUP BY c.id ORDER BY c.sort"""
    ).fetchall()
    for r in rows:
        out["collections"].append(dict(r))
        out["documents"] += r["docs"]
    cached = conn.execute("SELECT value FROM meta WHERE key='counts'").fetchone()
    c = json.loads(cached[0]) if cached else counts(conn)
    out["paragraphs"] = c["paragraphs"]
    out["verses"] = c["verses"]
    out["talks"] = conn.execute(
        "SELECT COUNT(*) FROM documents d JOIN collections c ON c.id=d.collection_id WHERE c.slug='general-conference'"
    ).fetchone()[0]
    run = conn.execute("SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1").fetchone()
    out["last_run"] = dict(run) if run else None
    latest = conn.execute(
        """SELECT year, month FROM documents d JOIN collections c ON c.id=d.collection_id
            WHERE c.slug='general-conference' AND year IS NOT NULL ORDER BY year DESC, month DESC LIMIT 1"""
    ).fetchone()
    out["latest_conference"] = dict(latest) if latest else None
    return out
