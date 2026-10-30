"""Seed the standard works from a public-domain JSON edition.

The nightly sync pulls every chapter from the Church's site with headings and
footnotes. That takes a while the first time, so this importer loads the bare
verse text (public domain, from github.com/bcbooks/scriptures-json) in a few
seconds. The sync later replaces each chapter in place with the full version.
"""

from __future__ import annotations

import html
import json
import logging
import re
import urllib.request
from collections import defaultdict
from pathlib import Path

from . import config, scriptures
from .db import Store
from .parse import ParsedDoc, Paragraph
import hashlib

log = logging.getLogger("gospel.seed")

RAW_BASE = "https://raw.githubusercontent.com/bcbooks/scriptures-json/master/flat/"
FILES = [
    "old-testament-flat.json",
    "new-testament-flat.json",
    "book-of-mormon-flat.json",
    "doctrine-and-covenants-flat.json",
    "pearl-of-great-price-flat.json",
]
_REF = re.compile(r"^(?P<book>.+?)\s+(?P<chapter>\d+):(?P<verse>\d+)$")


def load_file(name: str, source_dir: Path | None) -> dict:
    if source_dir is not None:
        return json.loads((source_dir / name).read_text(encoding="utf-8"))
    cache = config.DATA_DIR / "seed" / name
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    cache.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(RAW_BASE + name, headers={"User-Agent": config.USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read()
    cache.write_bytes(raw)
    return json.loads(raw)


def seed(store: Store, source_dir: Path | None = None) -> int:
    coll_sort = next(i for i, c in enumerate(config.COLLECTIONS) if c["slug"] == "scriptures")
    cid = store.collection_id("scriptures", "Scriptures", "books", coll_sort)
    added = 0
    for name in FILES:
        try:
            data = load_file(name, source_dir)
        except Exception as exc:  # noqa: BLE001
            log.warning("could not load %s (%s); skipping", name, exc)
            continue
        headings = {h["reference"]: h["text"] for h in data.get("headings", [])}
        chapters: dict[tuple[str, int], list[tuple[int, str]]] = defaultdict(list)
        order: list[tuple[str, int]] = []
        for v in data["verses"]:
            m = _REF.match(v["reference"].replace(" ", " "))
            if not m:
                continue
            ref = scriptures.parse_reference(f"{m.group('book')} {m.group('chapter')}")
            if ref is None:
                log.debug("unknown book in %s", v["reference"])
                continue
            key = (ref.book.slug, int(m.group("chapter")))
            if key not in chapters:
                order.append(key)
            chapters[key].append((int(m.group("verse")), v["text"]))
        for book_slug, chapter in order:
            book = scriptures.book(book_slug)
            uri = f"{book.uri}/{chapter}"
            if store.document_state(uri) is not None:
                continue
            volume_sort = next(i for i, c in enumerate(config.COLLECTIONS[coll_sort]["roots"]) if c in book.uri)
            volume_uri = config.COLLECTIONS[coll_sort]["roots"][volume_sort]
            book_id = store.book_id(cid, volume_uri, book.volume_name, sort=volume_sort)
            heading = headings.get(f"{book.name} {chapter}") or (headings.get(book.name) if chapter == book.chapters[0] else None)
            doc = _chapter_doc(book, chapter, chapters[(book_slug, chapter)], heading)
            extra = {
                "volume": book.volume_name, "book_slug": book.slug, "book_name": book.name,
                "chapter": str(chapter), "sort_key": scriptures.sort_key(uri),
            }
            _, outcome = store.save_document(collection_id=cid, book_id=book_id, doc=doc, node=None, extra=extra)
            if outcome == "added":
                added += 1
        log.info("%s: %d chapters", name.replace("-flat.json", ""), len(order))
    if added:
        store.optimize()
    # Seeded chapters should be replaced by the real pages soon, not in a week.
    store.conn.execute("UPDATE documents SET next_check=? WHERE content_type='seed'", ("1970-01-01T00:00:00Z",))
    store.conn.commit()
    return added


def _chapter_doc(book, chapter: int, verses: list[tuple[int, str]], heading: str | None) -> ParsedDoc:
    title = book.citation(chapter)
    paragraphs: list[Paragraph] = []
    parts = [f'<header><h1 id="title1">{html.escape(title)}</h1>']
    seq = 0
    if heading:
        seq += 1
        paragraphs.append(Paragraph(seq=seq, pid="study_summary1", kind="summary", text=heading))
        parts.append(f'<p class="study-summary" id="study_summary1">{html.escape(heading)}</p>')
    parts.append('</header><div class="body-block">')
    for n, text in verses:
        seq += 1
        paragraphs.append(Paragraph(seq=seq, pid=f"p{n}", kind="verse", text=text, verse=n))
        parts.append(f'<p class="verse" id="p{n}"><span class="verse-number">{n} </span>{html.escape(text)}</p>')
    parts.append("</div>")
    digest = hashlib.sha256(("seed:" + "\n".join(p.text for p in paragraphs)).encode("utf-8")).hexdigest()
    return ParsedDoc(
        uri=f"{book.uri}/{chapter}", title=title, subtitle=None, author=None, author_role=None, kicker=None,
        date=None, content_type="seed", body_html="".join(parts), paragraphs=paragraphs, footnotes=[],
        word_count=sum(len(t.split()) for _, t in verses), content_hash=digest,
    )
