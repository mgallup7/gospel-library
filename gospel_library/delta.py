"""Deltas: what changed between one published library and the next, so a
device that holds last week's library downloads a few megabytes instead of
the whole bundle again.

How it works. Every time the bundle is built, a snapshot of what was
published is kept in the working database (``snapshots``): for each document
its uri, content hash and paragraph range, and a bitmap of the paragraphs
that had a meaning vector. The next build compares the new library with each of the
last SNAPSHOT_KEEP snapshots and writes one delta file per snapshot:
``delta-<from>.bin``, a small SQLite database (sealed like the bundle) that
carries the documents added or changed since then with their paragraphs,
footnotes and vector bits, the uris of documents removed, the vector bits
embedded since, and the small tables that are simply replaced (collections,
books, the counts and other meta). The manifest lists them.

The device applies a delta in place (engine.js ``applyDelta``): delete the
old rows of every changed or removed document, insert the new ones, replace
the small tables, then recompute the library's version and compare it with
the version the delta promised. Any mismatch, or a delta that does
not fit (the originals or the model changed, too much changed), means the
whole bundle is downloaded instead, as before.
"""

from __future__ import annotations

import base64
import gzip
import hashlib
import json
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("gospel.delta")

SNAPSHOT_KEEP = 12          # deltas are offered from this many earlier builds
MAX_CHANGED_SHARE = 0.4     # more than this share of documents changed: the whole bundle is cheaper
SCHEMA_VERSION = 1          # bump when the device-side tables change shape

SNAPSHOT_SCHEMA = """
CREATE TABLE IF NOT EXISTS snapshots(
  version TEXT PRIMARY KEY,
  built_at TEXT NOT NULL,
  data BLOB NOT NULL
);
"""

# The delta file's own tables: plain tables (no FTS), the same columns the device has.
DELTA_SCHEMA = """
CREATE TABLE delta_meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE documents(
  id INTEGER PRIMARY KEY, collection_id INTEGER NOT NULL, book_id INTEGER, uri TEXT NOT NULL, title TEXT NOT NULL,
  subtitle TEXT, author TEXT, author_role TEXT, kicker TEXT, description TEXT, date TEXT, year INTEGER, month INTEGER,
  session TEXT, section_path TEXT, volume TEXT, book_slug TEXT, book_name TEXT, chapter TEXT, content_type TEXT,
  sort_key INTEGER, word_count INTEGER NOT NULL DEFAULT 0, body_html BLOB, par_first INTEGER, par_last INTEGER,
  content_hash TEXT, fetched_at TEXT, first_seen TEXT, changed_at TEXT, next_check TEXT,
  check_interval INTEGER NOT NULL DEFAULT 7, status TEXT NOT NULL DEFAULT 'ok'
);
CREATE TABLE removed(uri TEXT PRIMARY KEY, id INTEGER);
CREATE TABLE paragraphs(rowid INTEGER PRIMARY KEY, text TEXT, document_id INTEGER, seq INTEGER, pid TEXT, kind TEXT, verse INTEGER);
CREATE TABLE footnotes(id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL, note_id TEXT NOT NULL, marker TEXT, pid TEXT, html TEXT, text TEXT, refs TEXT);
CREATE TABLE vecbits(paragraph_id INTEGER PRIMARY KEY, bits BLOB NOT NULL);
CREATE TABLE collections(id INTEGER PRIMARY KEY, slug TEXT, title TEXT, kind TEXT, sort INTEGER, toc_next_check TEXT, status TEXT);
CREATE TABLE books(id INTEGER PRIMARY KEY, collection_id INTEGER, uri TEXT, title TEXT, sort INTEGER, parent_id INTEGER, kind TEXT, toc_next_check TEXT, status TEXT);
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
"""

DOC_COLS = ["id", "collection_id", "book_id", "uri", "title", "subtitle", "author", "author_role", "kicker", "description", "date", "year", "month",
            "session", "section_path", "volume", "book_slug", "book_name", "chapter", "content_type", "sort_key", "word_count", "body_html",
            "par_first", "par_last", "content_hash", "fetched_at", "first_seen", "changed_at", "next_check", "check_interval", "status"]


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def content_version(conn: sqlite3.Connection) -> str:
    """Changes only when the text of the library changes, not when it was fetched."""
    h = hashlib.sha256()
    for uri, digest in conn.execute("SELECT uri, content_hash FROM documents ORDER BY uri"):
        h.update(f"{uri}:{digest}\n".encode("utf-8"))
    return h.hexdigest()[:16]


def library_version(conn: sqlite3.Connection) -> str:
    """The version the manifest publishes: the text, plus everything else a device holds that can
    change on its own (the meaning vectors, their model, the original-language tables). A device
    computes the same string from its own copy (engine.js ``libraryVersion``), so a delta can be
    checked against what it promised."""
    table = next((t for t in ("vecbits", "vectors") if conn.execute("SELECT 1 FROM sqlite_master WHERE name=?", (t,)).fetchone()), None)
    count, top = conn.execute(f"SELECT COUNT(*), COALESCE(MAX(paragraph_id), 0) FROM {table}").fetchone() if table else (0, 0)
    model = (_meta(conn, "embeddings") or {}).get("model") or ""
    originals = (_meta(conn, "originals") or {}).get("format") or ""
    seed = f"{content_version(conn)}|vectors:{count}:{top}|model:{model}|originals:{originals}"
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]


def _meta(conn: sqlite3.Connection, key: str):
    row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return json.loads(row[0]) if row and row[0] else None


def _table_cols(conn: sqlite3.Connection, table: str) -> list[str]:
    schema, _, name = table.rpartition(".")
    pragma = f"PRAGMA {schema}.table_info({name})" if schema else f"PRAGMA table_info({name})"
    return [r[1] for r in conn.execute(pragma)]


def take_snapshot(conn: sqlite3.Connection, version: str) -> dict:
    """What this build published: enough to describe every later change against it."""
    docs = {}
    for r in conn.execute("SELECT uri, id, content_hash, par_first, par_last FROM documents"):
        docs[r[0]] = [r[1], r[2], r[3], r[4]]
    # which paragraphs had a vector: one bit each, so the next build can ship exactly the vectors embedded since
    vec_table = next((t for t in ("vectors", "vecbits") if conn.execute("SELECT 1 FROM sqlite_master WHERE name=?", (t,)).fetchone()), None)
    vec_max = conn.execute(f"SELECT COALESCE(MAX(paragraph_id), 0) FROM {vec_table}").fetchone()[0] if vec_table else 0
    bitmap = bytearray(vec_max // 8 + 1)
    if vec_table:
        for (pid,) in conn.execute(f"SELECT paragraph_id FROM {vec_table}"):
            bitmap[pid >> 3] |= 1 << (pid & 7)
    originals = _meta(conn, "originals") or {}
    embeddings = _meta(conn, "embeddings") or {}
    return {
        "version": version, "schema": SCHEMA_VERSION, "built_at": _now(),
        "docs": docs, "vec_max": vec_max, "vec_bitmap": base64.b64encode(bytes(bitmap)).decode("ascii"),
        "originals_format": originals.get("format"), "model": embeddings.get("model"), "dims": embeddings.get("dims"),
        "paragraphs": conn.execute("SELECT COUNT(*) FROM paragraphs").fetchone()[0],
    }


def save_snapshot(conn: sqlite3.Connection, snap: dict) -> None:
    conn.executescript(SNAPSHOT_SCHEMA)
    blob = gzip.compress(json.dumps(snap, separators=(",", ":")).encode("utf-8"), 6)
    conn.execute("INSERT OR REPLACE INTO snapshots(version, built_at, data) VALUES (?,?,?)", (snap["version"], snap["built_at"], blob))
    old = conn.execute("SELECT version FROM snapshots ORDER BY built_at DESC").fetchall()[SNAPSHOT_KEEP:]
    for (v,) in old:
        conn.execute("DELETE FROM snapshots WHERE version=?", (v,))
    conn.commit()


def load_snapshots(conn: sqlite3.Connection) -> list[dict]:
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name='snapshots'").fetchone():
        return []
    out = []
    for version, built_at, data in conn.execute("SELECT version, built_at, data FROM snapshots ORDER BY built_at DESC"):
        try:
            out.append(json.loads(gzip.decompress(data).decode("utf-8")))
        except Exception as exc:  # pragma: no cover
            log.warning("snapshot %s unreadable: %s", version, exc)
    return out


def plan(snap: dict, now: sqlite3.Connection) -> dict | None:
    """Which documents a device at the snapshot must receive, or None when a delta would not fit."""
    if snap.get("schema") != SCHEMA_VERSION:
        return None
    originals = _meta(now, "originals") or {}
    embeddings = _meta(now, "embeddings") or {}
    if originals.get("format") != snap.get("originals_format"):
        return None  # the Hebrew and Greek tables are not in a delta
    if snap.get("model") and (embeddings.get("model") != snap.get("model") or embeddings.get("dims") != snap.get("dims")):
        return None  # vectors from another model: every vector changes, the whole bundle is cheaper
    before = snap["docs"]
    changed, kept = [], 0
    seen = set()
    for r in now.execute("SELECT uri, id, content_hash, par_first, par_last FROM documents"):
        uri, doc_id, digest, first, last = r
        seen.add(uri)
        old = before.get(uri)
        if old and old[0] == doc_id and old[1] == digest and old[2] == first and old[3] == last:
            kept += 1
        else:
            changed.append((uri, doc_id, old[0] if old else None, old[2] if old else None, old[3] if old else None))
    removed = [(uri, old[0]) for uri, old in before.items() if uri not in seen]
    total = kept + len(changed)
    if total and (len(changed) + len(removed)) / max(1, len(before)) > MAX_CHANGED_SHARE:
        return None
    return {"changed": changed, "removed": removed, "kept": kept}


def build_delta(now: sqlite3.Connection, compact_path: Path, snap: dict, version_to: str, out_path: Path, passphrase: str) -> dict | None:
    """Write out_path (sealed) carrying everything a device at the snapshot needs to become version_to."""
    from .bundle import encrypt_file

    p = plan(snap, now)
    if p is None:
        return None
    tmp = out_path.with_suffix(".sqlite")
    tmp.unlink(missing_ok=True)
    d = sqlite3.connect(tmp)
    try:
        d.executescript(DELTA_SCHEMA)
        d.execute("ATTACH DATABASE ? AS src", (str(compact_path),))
        src_doc_cols = set(_table_cols(d, "src.documents"))
        cols = [c for c in DOC_COLS if c in src_doc_cols]
        ids = [doc_id for _, doc_id, *_ in p["changed"]]
        paragraphs = footnotes = 0
        for i in range(0, len(ids), 500):
            chunk = ids[i:i + 500]
            q = ",".join("?" * len(chunk))
            d.execute(f"INSERT INTO documents({','.join(cols)}) SELECT {','.join(cols)} FROM src.documents WHERE id IN ({q})", chunk)
            footnotes += d.execute(f"INSERT INTO footnotes(id, document_id, note_id, marker, pid, html, text, refs) SELECT id, document_id, note_id, marker, pid, html, text, refs FROM src.footnotes WHERE document_id IN ({q})", chunk).rowcount
        # the changed documents' paragraphs, by their rowid ranges (an FTS table is read by rowid, never scanned)
        for first, last in d.execute("SELECT par_first, par_last FROM documents WHERE par_first IS NOT NULL").fetchall():
            paragraphs += d.execute("INSERT INTO paragraphs(rowid, text, document_id, seq, pid, kind, verse) SELECT rowid, text, document_id, seq, pid, kind, verse FROM src.paragraphs WHERE rowid BETWEEN ? AND ?", (first, last)).rowcount
        vec = 0
        if d.execute("SELECT 1 FROM src.sqlite_master WHERE name='vecbits'").fetchone():
            # the vectors of the changed documents, and every vector embedded since the snapshot
            vec += d.execute("INSERT OR IGNORE INTO vecbits(paragraph_id, bits) SELECT v.paragraph_id, v.bits FROM src.vecbits v JOIN paragraphs p ON p.rowid = v.paragraph_id").rowcount
            had = base64.b64decode(snap.get("vec_bitmap", "")) if snap.get("vec_bitmap") else b""
            fresh = [pid for (pid,) in d.execute("SELECT paragraph_id FROM src.vecbits") if (pid >> 3) >= len(had) or not (had[pid >> 3] >> (pid & 7)) & 1]
            for i in range(0, len(fresh), 500):
                chunk = fresh[i:i + 500]
                vec += d.execute(f"INSERT OR IGNORE INTO vecbits(paragraph_id, bits) SELECT paragraph_id, bits FROM src.vecbits WHERE paragraph_id IN ({','.join('?' * len(chunk))})", chunk).rowcount
        d.executemany("INSERT INTO removed(uri, id) VALUES (?, ?)", [(uri, doc_id) for uri, doc_id in p["removed"]])
        # the small tables travel whole
        ccols = [c for c in _table_cols(d, "collections") if c in set(_table_cols(d, "src.collections"))]
        d.execute(f"INSERT INTO collections({','.join(ccols)}) SELECT {','.join(ccols)} FROM src.collections")
        bcols = [c for c in _table_cols(d, "books") if c in set(_table_cols(d, "src.books"))]
        d.execute(f"INSERT INTO books({','.join(bcols)}) SELECT {','.join(bcols)} FROM src.books")
        d.execute("INSERT INTO meta(key, value) SELECT key, value FROM src.meta WHERE key IN ('counts', 'bundle', 'embeddings', 'originals')")
        total_pars = d.execute("SELECT COUNT(*) FROM src.paragraphs").fetchone()[0]
        total_docs = d.execute("SELECT COUNT(*) FROM src.documents").fetchone()[0]
        info = {"from": snap["version"], "to": version_to, "built_at": _now(), "schema": SCHEMA_VERSION,
                "documents_changed": len(p["changed"]), "documents_removed": len(p["removed"]), "paragraphs": paragraphs, "footnotes": footnotes, "vecbits": vec,
                "documents_total": total_docs, "paragraphs_total": total_pars}
        d.executemany("INSERT INTO delta_meta(key, value) VALUES (?, ?)", [(k, json.dumps(v)) for k, v in info.items()])
        d.commit()
        d.execute("DETACH DATABASE src")
        d.execute("VACUUM")
    finally:
        d.close()
    header = encrypt_file(tmp, out_path, passphrase, extra={"kind": "delta", "from": snap["version"], "version": version_to})
    tmp.unlink(missing_ok=True)
    info.update({"file": out_path.name, "size": header["bundle_size"], "sha256": header["sha256"], "plain_size": header["plain_size"]})
    log.info("delta %s -> %s: %d changed, %d removed, %d paragraphs, %d vectors, %.1f MB", info["from"], version_to, info["documents_changed"], info["documents_removed"], paragraphs, vec, info["size"] / 1e6)
    return info


def build_all(now: sqlite3.Connection, compact_path: Path, version_to: str, out_dir: Path, passphrase: str) -> list[dict]:
    """A delta from every kept snapshot to the library being published, newest first."""
    out = []
    for snap in load_snapshots(now):
        if snap["version"] == version_to:
            continue
        try:
            info = build_delta(now, compact_path, snap, version_to, out_dir / f"delta-{snap['version']}.bin", passphrase)
        except Exception as exc:  # a bad delta is skipped, never shipped
            log.warning("delta from %s not built: %s", snap["version"], exc)
            continue
        if info:
            out.append(info)
    return out


def apply_delta(conn: sqlite3.Connection, delta_path: Path) -> dict:
    """The reference application of a delta to a device-shaped library (the browser engine mirrors this).

    conn holds the device's library (an unsealed bundle); delta_path is the unsealed delta database.
    Raises ValueError when the library is not the one the delta was built from, or the result
    does not match the version the delta promised; the library is left as it was either way.
    """
    conn.execute("ATTACH DATABASE ? AS d", (str(delta_path),))
    try:
        info = {k: json.loads(v) for k, v in conn.execute("SELECT key, value FROM d.delta_meta")}
        have = library_version(conn)
        if have != info["from"]:
            raise ValueError(f"this delta is for a library at {info['from']}; this one is at {have}")
        conn.execute("BEGIN")
        # out with the old rows of every changed or removed document
        gone = conn.execute("SELECT id, par_first, par_last FROM documents WHERE uri IN (SELECT uri FROM d.documents UNION SELECT uri FROM d.removed)").fetchall()
        for doc_id, first, last in gone:
            if first is not None:
                conn.execute("DELETE FROM paragraphs WHERE rowid BETWEEN ? AND ?", (first, last))
                if conn.execute("SELECT 1 FROM sqlite_master WHERE name='vecbits'").fetchone():
                    conn.execute("DELETE FROM vecbits WHERE paragraph_id BETWEEN ? AND ?", (first, last))
            conn.execute("DELETE FROM footnotes WHERE document_id=?", (doc_id,))
            conn.execute("DELETE FROM documents WHERE id=?", (doc_id,))
        # in with the new
        cols = [c for c in DOC_COLS if c in set(_table_cols(conn, "documents"))]
        conn.execute(f"INSERT INTO documents({','.join(cols)}) SELECT {','.join(cols)} FROM d.documents")
        conn.execute("INSERT INTO paragraphs(rowid, text, document_id, seq, pid, kind, verse) SELECT rowid, text, document_id, seq, pid, kind, verse FROM d.paragraphs")
        conn.execute("INSERT INTO footnotes(id, document_id, note_id, marker, pid, html, text, refs) SELECT id, document_id, note_id, marker, pid, html, text, refs FROM d.footnotes")
        if conn.execute("SELECT 1 FROM sqlite_master WHERE name='vecbits'").fetchone():
            conn.execute("INSERT OR REPLACE INTO vecbits(paragraph_id, bits) SELECT paragraph_id, bits FROM d.vecbits")
        elif conn.execute("SELECT COUNT(*) FROM d.vecbits").fetchone()[0]:
            conn.execute("CREATE TABLE vecbits(paragraph_id INTEGER PRIMARY KEY, bits BLOB NOT NULL)")
            conn.execute("INSERT INTO vecbits(paragraph_id, bits) SELECT paragraph_id, bits FROM d.vecbits")
        conn.execute("DELETE FROM collections")
        ccols = [c for c in _table_cols(conn, "collections") if c in set(_table_cols(conn, "d.collections"))]
        conn.execute(f"INSERT INTO collections({','.join(ccols)}) SELECT {','.join(ccols)} FROM d.collections")
        conn.execute("DELETE FROM books")
        bcols = [c for c in _table_cols(conn, "books") if c in set(_table_cols(conn, "d.books"))]
        conn.execute(f"INSERT INTO books({','.join(bcols)}) SELECT {','.join(bcols)} FROM d.books")
        conn.execute("INSERT OR REPLACE INTO meta(key, value) SELECT key, value FROM d.meta")
        got = library_version(conn)
        pars = conn.execute("SELECT COUNT(*) FROM paragraphs").fetchone()[0]
        if got != info["to"] or pars != info["paragraphs_total"]:
            conn.execute("ROLLBACK")
            raise ValueError(f"the delta did not reproduce the library (version {got} vs {info['to']}, {pars} vs {info['paragraphs_total']} paragraphs)")
        conn.execute("COMMIT")
        return info
    finally:
        conn.execute("DETACH DATABASE d")
