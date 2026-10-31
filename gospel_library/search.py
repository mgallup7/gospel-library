"""Search: query compilation, ranking, snippets, and reference jumps.

What a person types in the box is turned into an FTS5 MATCH expression plus
SQL filters. Supported shorthand, all optional:

    "plan of happiness"        exact phrase
    faith -works               must not contain
    hope OR charity            either
    speaker:nelson             talks by a speaker (substring match)
    year:2020  year:2015-2020  conference year or range
    book:alma                  a scripture book (name or abbreviation)
    in:scriptures  in:conference  in:handbook  in:cfm  in:manuals  in:helps

A bare citation such as "Alma 32:21" or "d&c 76 22" is recognised and offered
as a jump straight to that verse.
"""

from __future__ import annotations

import html
import json
import re
import sqlite3
from dataclasses import dataclass, field

from . import scriptures
from .db import decompress_html

_SCOPES = {
    "scriptures": ["scriptures"],
    "scripture": ["scriptures"],
    "conference": ["general-conference"],
    "talks": ["general-conference"],
    "gc": ["general-conference"],
    "handbook": ["handbook"],
    "cfm": ["come-follow-me"],
    "pmg": ["preach-my-gospel"],
    "manuals": ["manuals", "come-follow-me", "handbook", "preach-my-gospel"],
    "manual": ["manuals", "come-follow-me", "handbook", "preach-my-gospel"],
    "helps": ["study-helps"],
    "all": [],
}
_FILTER = re.compile(r'(?P<key>speaker|by|year|book|in|scope):(?P<val>"[^"]+"|\S+)', re.I)
_TOKEN = re.compile(r'"([^"]*)"|(\S+)')
HL_OPEN, HL_CLOSE = "\u0001", "\u0002"


@dataclass
class Query:
    raw: str
    match: str | None = None
    collections: list[str] = field(default_factory=list)
    speaker: str | None = None
    year_from: int | None = None
    year_to: int | None = None
    book_slug: str | None = None
    terms: list[str] = field(default_factory=list)


def compile_query(raw: str, *, typeahead: bool = False, scope: str | None = None) -> Query:
    q = Query(raw=raw)
    text = raw.strip()
    if scope and scope in _SCOPES:
        q.collections = list(_SCOPES[scope])

    def take(m: re.Match) -> str:
        key, val = m.group("key").lower(), m.group("val").strip('"')
        if key in ("speaker", "by"):
            q.speaker = val
        elif key == "year":
            parts = re.split(r"[-–]", val)
            try:
                q.year_from = int(parts[0])
                q.year_to = int(parts[1]) if len(parts) > 1 and parts[1] else q.year_from
            except ValueError:
                pass
        elif key == "book":
            ref = scriptures.parse_reference(val)
            if ref:
                q.book_slug = ref.book.slug
        elif key in ("in", "scope") and val.lower() in _SCOPES:
            q.collections = list(_SCOPES[val.lower()])
        return " "

    text = _FILTER.sub(take, text)
    ends_with_space = raw.endswith(" ")
    pieces: list[str] = []
    negatives: list[str] = []
    tokens = _TOKEN.findall(text)
    for i, (phrase, word) in enumerate(tokens):
        last = i == len(tokens) - 1
        if phrase is not None and phrase != "":
            p = _phrase(phrase)
            if p:
                pieces.append(p)
                q.terms.append(phrase)
            continue
        if word in ("OR", "AND", "NOT"):
            if word == "OR" and pieces:
                pieces.append("OR")
            continue
        negate = word.startswith("-") and len(word) > 1
        core = word[1:] if negate else word
        words = _words(core)
        if not words:
            continue
        if negate:
            negatives.append(_phrase(" ".join(words)))
            continue
        q.terms.extend(words)
        expr = _phrase(" ".join(words))
        if typeahead and last and not ends_with_space and len(words[-1]) >= 2:
            expr = expr + "*"
        pieces.append(expr)

    # tidy dangling operators
    while pieces and pieces[-1] == "OR":
        pieces.pop()
    while pieces and pieces[0] == "OR":
        pieces.pop(0)
    if pieces:
        match = " ".join(pieces)
        for n in negatives:
            match = f"({match}) NOT {n}"
        q.match = match
    return q


def _words(text: str) -> list[str]:
    # FTS5's unicode61 tokenizer splits on anything that is not a letter or
    # number, so "covenant-path" and "Lord's" become two tokens each.
    return [w for w in re.split(r"[^\w]+", text.replace("’", "'"), flags=re.UNICODE) if w]


def _phrase(text: str) -> str:
    words = _words(text)
    if not words:
        return ""
    return '"' + " ".join(words).replace('"', '""') + '"'


# ---------------------------------------------------------------------------

def search(conn: sqlite3.Connection, raw: str, *, scope: str | None = None, typeahead: bool = False,
           limit: int = 40, offset: int = 0, speaker: str | None = None, year_from: int | None = None,
           year_to: int | None = None, book: str | None = None, group: str = "passages") -> dict:
    out: dict = {"query": raw, "hits": [], "total": 0, "documents": [], "jump": None, "titles": []}
    q = compile_query(raw, typeahead=typeahead, scope=scope)
    if speaker:
        q.speaker = speaker
    if year_from:
        q.year_from = year_from
    if year_to:
        q.year_to = year_to
    if book:
        ref = scriptures.parse_reference(book)
        q.book_slug = ref.book.slug if ref else q.book_slug

    ref = scriptures.parse_reference(raw) if not (q.speaker or q.year_from or q.collections) else None
    if ref is not None:
        row = conn.execute("SELECT id, title FROM documents WHERE uri=?", (ref.uri,)).fetchone()
        out["jump"] = {
            "label": ref.label,
            "uri": ref.uri,
            "pid": ref.pid,
            "doc_id": row["id"] if row else None,
            "title": row["title"] if row else ref.book.citation(ref.chapter),
            "verse_end": ref.verse_end,
        }

    if not q.match:
        return out

    where = ["paragraphs MATCH ?"]
    params: list = [q.match]
    if q.collections:
        where.append(f"c.slug IN ({','.join('?' for _ in q.collections)})")
        params.extend(q.collections)
    if q.speaker:
        where.append("d.author LIKE ?")
        params.append(f"%{q.speaker}%")
    if q.year_from:
        where.append("d.year >= ?")
        params.append(q.year_from)
    if q.year_to:
        where.append("d.year <= ?")
        params.append(q.year_to)
    if q.book_slug:
        where.append("d.book_slug = ?")
        params.append(q.book_slug)
    where_sql = " AND ".join(where)

    base = f"""
        FROM paragraphs p
        JOIN documents d ON d.id = p.document_id
        JOIN collections c ON c.id = d.collection_id
        WHERE {where_sql}"""

    try:
        if group == "documents":
            rows = conn.execute(
                f"""SELECT d.id, d.uri, d.title, d.author, d.year, d.month, d.session, d.book_slug, d.book_name,
                           d.chapter, d.volume, c.slug AS collection, COUNT(*) AS hits, MIN(p.rank) AS best
                    {base} GROUP BY d.id ORDER BY best LIMIT ? OFFSET ?""",
                (*params, limit, offset),
            ).fetchall()
            out["documents"] = [_doc_summary(r) | {"hits": r["hits"]} for r in rows]
            out["total"] = conn.execute(f"SELECT COUNT(DISTINCT d.id) {base}", params).fetchone()[0]
            return out

        rows = conn.execute(
            f"""SELECT p.rowid AS paragraph_id, p.document_id, p.pid, p.kind, p.verse, p.text,
                       snippet(paragraphs, 0, ?, ?, ' … ', 48) AS snip,
                       bm25(paragraphs) AS rank,
                       d.uri, d.title, d.author, d.author_role, d.year, d.month, d.session, d.date,
                       d.book_slug, d.book_name, d.chapter, d.volume, c.slug AS collection
                {base} ORDER BY rank LIMIT ? OFFSET ?""",
            (HL_OPEN, HL_CLOSE, *params, limit, offset),
        ).fetchall()
        out["total"] = conn.execute(f"SELECT COUNT(*) {base}", params).fetchone()[0]
    except sqlite3.OperationalError as exc:
        out["error"] = f"could not run that query ({exc})"
        return out

    for r in rows:
        hit = _doc_summary(r)
        hit.update(
            paragraph_id=r["paragraph_id"],
            doc_id=r["document_id"],
            pid=r["pid"],
            kind=r["kind"],
            verse=r["verse"],
            snippet=_mark_terms(r["text"], q.terms) if r["kind"] == "verse" else _highlight(r["snip"]),
            citation=_citation(r),
        )
        out["hits"].append(hit)

    # Titles that match (talks and chapters named for what was typed)
    if offset == 0 and q.terms:
        title_match = " ".join(_phrase(t) for t in q.terms)
        twhere = ["documents_fts MATCH ?"]
        tparams: list = [f"title : ({title_match})"]
        if q.collections:
            twhere.append(f"c.slug IN ({','.join('?' for _ in q.collections)})")
            tparams.extend(q.collections)
        if q.speaker:
            twhere.append("d.author LIKE ?")
            tparams.append(f"%{q.speaker}%")
        try:
            trows = conn.execute(
                f"""SELECT d.id, d.uri, d.title, d.author, d.year, d.month, d.session, d.book_slug, d.book_name,
                          d.chapter, d.volume, c.slug AS collection
                     FROM documents_fts f JOIN documents d ON d.id=f.rowid JOIN collections c ON c.id=d.collection_id
                    WHERE {' AND '.join(twhere)} ORDER BY bm25(documents_fts) LIMIT 6""",
                tparams,
            ).fetchall()
            out["titles"] = [_doc_summary(r) for r in trows]
        except sqlite3.OperationalError:
            pass
    return out


def _doc_summary(r: sqlite3.Row) -> dict:
    return {
        "doc_id": r["id"] if "id" in r.keys() else r["document_id"],
        "uri": r["uri"],
        "title": r["title"],
        "author": r["author"],
        "year": r["year"],
        "month": r["month"],
        "session": r["session"],
        "collection": r["collection"],
        "book_slug": r["book_slug"],
        "book_name": r["book_name"],
        "chapter": r["chapter"],
        "volume": r["volume"],
        "label": doc_label(r),
    }


def doc_label(r) -> str:
    """One line that places a document: 'October 2023 General Conference' or 'Book of Mormon'."""
    coll = r["collection"]
    if coll == "general-conference" and r["year"]:
        return f"{'April' if r['month'] == 4 else 'October'} {r['year']} General Conference"
    if r["volume"]:
        return r["volume"]
    return {"handbook": "General Handbook", "come-follow-me": "Come, Follow Me", "preach-my-gospel": "Preach My Gospel",
            "manuals": "Manual", "study-helps": "Study Helps", "scriptures": "Scriptures"}.get(coll, coll or "")


def _citation(r: sqlite3.Row) -> str:
    if r["book_slug"]:
        b = scriptures.book(r["book_slug"])
        if b is not None:
            chapter = r["chapter"]
            try:
                chapter = int(chapter)
            except (TypeError, ValueError):
                pass
            return b.citation(chapter, r["verse"]) if chapter is not None else b.citation()
    if r["collection"] == "general-conference":
        who = r["author"] or ""
        when = f"{'Apr' if r['month'] == 4 else 'Oct'} {r['year']}" if r["year"] else ""
        return ", ".join(x for x in (who, f"“{r['title']}”", when) if x)
    return r["title"]


def _highlight(snip: str) -> str:
    return html.escape(snip, quote=False).replace(HL_OPEN, "<mark>").replace(HL_CLOSE, "</mark>")


def _mark_terms(text: str, terms: list[str]) -> str:
    escaped = html.escape(text, quote=False)
    if not terms:
        return escaped
    stems = sorted({t.lower() for t in terms if len(t) >= 2}, key=len, reverse=True)
    pattern = re.compile(r"\b(" + "|".join(re.escape(s) + r"\w*" for s in stems) + r")", re.I)
    return pattern.sub(lambda m: f"<mark>{m.group(1)}</mark>", escaped)


# ---------------------------------------------------------------------------

def speakers(conn: sqlite3.Connection, prefix: str | None = None, limit: int = 300) -> list[dict]:
    where = "WHERE c.slug='general-conference' AND d.author IS NOT NULL AND d.author != ''"
    params: list = []
    if prefix:
        where += " AND d.author LIKE ?"
        params.append(f"%{prefix}%")
    rows = conn.execute(
        f"""SELECT d.author AS name, COUNT(*) AS talks, MIN(d.year) AS first_year, MAX(d.year) AS last_year
              FROM documents d JOIN collections c ON c.id=d.collection_id {where}
             GROUP BY d.author ORDER BY talks DESC, name LIMIT ?""",
        (*params, limit),
    ).fetchall()
    return [dict(r) for r in rows]


def resolve(conn: sqlite3.Connection, href: str) -> dict | None:
    """Map a site link to a local document and paragraph."""
    from urllib.parse import parse_qs, urlparse
    from .fetch import normalize_uri

    parsed = urlparse(href)
    uri = normalize_uri(parsed.path or href)
    params = parse_qs(parsed.query)
    pid = None
    if params.get("id"):
        pid = params["id"][0].split(",")[0].split("-")[0]
    if parsed.fragment and not pid:
        pid = parsed.fragment
    row = conn.execute(
        "SELECT d.id, d.uri, d.title, c.slug AS collection FROM documents d JOIN collections c ON c.id=d.collection_id WHERE d.uri=?",
        (uri,),
    ).fetchone()
    if row is None:
        return None
    return {"doc_id": row["id"], "uri": row["uri"], "title": row["title"], "pid": pid, "collection": row["collection"]}


def document(conn: sqlite3.Connection, *, doc_id: int | None = None, uri: str | None = None) -> dict | None:
    if doc_id is not None:
        row = conn.execute(
            "SELECT d.*, c.slug AS collection, c.title AS collection_title FROM documents d JOIN collections c ON c.id=d.collection_id WHERE d.id=?",
            (doc_id,),
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT d.*, c.slug AS collection, c.title AS collection_title FROM documents d JOIN collections c ON c.id=d.collection_id WHERE d.uri=?",
            (uri,),
        ).fetchone()
    if row is None:
        return None
    doc = {k: row[k] for k in row.keys() if k not in ("content_hash", "body_html")}
    doc["body_html"] = decompress_html(row["body_html"])
    doc["section_path"] = json.loads(row["section_path"]) if row["section_path"] else []
    doc["label"] = doc_label(row)
    doc["citation"] = _doc_citation(row)
    notes = conn.execute(
        "SELECT note_id, marker, pid, html, text, refs FROM footnotes WHERE document_id=? ORDER BY id", (row["id"],)
    ).fetchall()
    doc["footnotes"] = [dict(n) | {"refs": json.loads(n["refs"] or "[]")} for n in notes]
    book = conn.execute("SELECT id, uri, title FROM books WHERE id=?", (row["book_id"],)).fetchone() if row["book_id"] else None
    doc["book"] = dict(book) if book else None
    # neighbours within the same book, in reading order
    if row["book_id"] is not None:
        nxt = conn.execute(
            "SELECT id, title, uri FROM documents WHERE book_id=? AND (sort_key > ? OR (sort_key = ? AND id > ?)) ORDER BY sort_key, id LIMIT 1",
            (row["book_id"], row["sort_key"] or 0, row["sort_key"] or 0, row["id"]),
        ).fetchone()
        prv = conn.execute(
            "SELECT id, title, uri FROM documents WHERE book_id=? AND (sort_key < ? OR (sort_key = ? AND id < ?)) ORDER BY sort_key DESC, id DESC LIMIT 1",
            (row["book_id"], row["sort_key"] or 0, row["sort_key"] or 0, row["id"]),
        ).fetchone()
        doc["next"] = dict(nxt) if nxt else None
        doc["prev"] = dict(prv) if prv else None
    else:
        doc["next"] = doc["prev"] = None
    doc["source_url"] = f"https://www.churchofjesuschrist.org/study{row['uri']}?lang=eng"
    return doc


def _doc_citation(row) -> str:
    class _R(dict):
        def __getitem__(self, k):
            return self.get(k)
    r = _R({k: row[k] for k in row.keys()})
    r["verse"] = None
    return _citation(r)
