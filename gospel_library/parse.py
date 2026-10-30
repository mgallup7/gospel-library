"""Turn a content-API payload into something we can store and search.

The payload looks like ``{"meta": {...}, "content": {"head": ..., "body":
"<header>...</header><div class=\"body-block\">...</div>", "footnotes":
{...}}}``. The body is clean, machine-generated HTML: paragraphs carry an
``id`` and a ``data-aid``, verses are ``<p class="verse">`` with a
``<span class="verse-number">``, footnote markers are ``<a
class="study-note-ref">`` wrapping ``<sup class="marker">``.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from dataclasses import dataclass, field

from bs4 import BeautifulSoup, NavigableString, Tag

_BYLINE_LEAD = re.compile(r"^(?:By|Presented by|Read by|Delivered by|Given by)\s+", re.I)
_UNIT_TAGS = ("h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "figcaption", "tr", "dt", "dd")
_SKIP_WITHIN = ("nav", "video", "audio", "script", "style", "footer")


@dataclass
class Paragraph:
    seq: int
    pid: str
    kind: str  # title, subtitle, heading, summary, verse, byline, kicker, para
    text: str
    verse: int | None = None


@dataclass
class Footnote:
    note_id: str
    marker: str
    html: str
    text: str
    pid: str | None
    refs: list[dict] = field(default_factory=list)


@dataclass
class ParsedDoc:
    uri: str
    title: str
    subtitle: str | None
    author: str | None
    author_role: str | None
    kicker: str | None
    date: str | None
    content_type: str | None
    body_html: str
    paragraphs: list[Paragraph]
    footnotes: list[Footnote]
    word_count: int
    content_hash: str
    description: str | None = None


def parse_content(payload: dict, uri: str) -> ParsedDoc:
    meta = payload.get("meta") or {}
    content = payload.get("content") or {}
    body_html = content.get("body") or ""
    soup = BeautifulSoup(body_html, "lxml")
    root = soup.body or soup

    header = root.find("header")
    title = _text(root.find("h1")) or _clean(meta.get("title")) or uri
    subtitle = _text(root.select_one("header .subtitle, header .title-number"))
    author_node = root.select_one(".byline .author-name, .author-name")
    author = _BYLINE_LEAD.sub("", _text(author_node)) if author_node else None
    author_role = _text(root.select_one(".byline .author-role, .author-role")) or None
    kicker = _text(root.select_one("header .kicker, p.kicker")) or None

    structured = _structured_data(meta)
    date = None
    if structured:
        date = (structured.get("datePublished") or structured.get("dateModified") or "")[:10] or None
        if not author:
            entity = structured.get("mainEntity") or {}
            person = entity.get("author") or structured.get("author") or {}
            if isinstance(person, dict) and person.get("name"):
                author = _clean(person["name"])
    page_attrs = meta.get("pageAttributes") or {}
    content_type = page_attrs.get("data-content-type") or meta.get("contentType")
    description = None
    head = content.get("head") or {}
    if isinstance(head, dict):
        pm = (head.get("page-meta-social") or {}).get("pageMeta") or {}
        description = _clean(pm.get("description")) or None

    paragraphs = _extract_paragraphs(root)
    footnotes = _extract_footnotes(content.get("footnotes"), root, paragraphs)

    word_count = sum(len(p.text.split()) for p in paragraphs if p.kind in ("para", "verse", "summary"))
    digest = hashlib.sha256("\n".join(p.text for p in paragraphs).encode("utf-8")).hexdigest()

    return ParsedDoc(
        uri=uri,
        title=title,
        subtitle=subtitle or None,
        author=author or None,
        author_role=author_role,
        kicker=kicker,
        date=date,
        content_type=content_type,
        body_html=_reader_html(root),
        paragraphs=paragraphs,
        footnotes=footnotes,
        word_count=word_count,
        content_hash=digest,
        description=description,
    )


# ---------------------------------------------------------------------------
# paragraphs
# ---------------------------------------------------------------------------

def _extract_paragraphs(root: Tag) -> list[Paragraph]:
    units: list[Paragraph] = []
    seq = 0
    seen_ids: set[str] = set()
    for el in root.find_all(_UNIT_TAGS):
        if _inside(el, _SKIP_WITHIN):
            continue
        if el.name == "li" and el.find(["p", "li", "h2", "h3", "h4"]):
            continue  # its children will be collected on their own
        if el.name == "tr":
            if el.find(["p", "li"]):
                continue
            text = " | ".join(_clean(td.get_text(" ")) for td in el.find_all(["td", "th"]))
        else:
            text = _unit_text(el)
        if not text:
            continue
        kind = _kind(el)
        pid = el.get("id") or el.get("data-aid")
        if not pid or pid in seen_ids:
            pid = f"x{seq + 1}"
        seen_ids.add(pid)
        verse = None
        if kind == "verse":
            num = el.select_one(".verse-number")
            if num is not None:
                m = re.search(r"\d+", num.get_text())
                verse = int(m.group()) if m else None
        seq += 1
        units.append(Paragraph(seq=seq, pid=pid, kind=kind, text=text, verse=verse))
    return units


def _kind(el: Tag) -> str:
    classes = set(el.get("class") or [])
    if el.name == "h1":
        return "title"
    if el.name in ("h2", "h3", "h4", "h5", "h6"):
        return "heading"
    if "verse" in classes:
        return "verse"
    if classes & {"study-summary", "study-intro", "intro", "summary"}:
        return "summary"
    if classes & {"subtitle", "title-number", "dominant"}:
        return "subtitle"
    if classes & {"author-name", "author-role"}:
        return "byline"
    if "kicker" in classes:
        return "kicker"
    return "para"


def _unit_text(el: Tag) -> str:
    node = copy.copy(el)
    for junk in node.select("sup.marker, .verse-number, .page-break, .marker"):
        junk.decompose()
    for br in node.find_all("br"):
        br.replace_with(" ")
    for line in node.select(".line, .para-mark, .stanza"):
        line.append(" ")
    return _clean(node.get_text())


def _inside(el: Tag, names) -> bool:
    for parent in el.parents:
        if isinstance(parent, Tag) and parent.name in names:
            return True
    return False


# ---------------------------------------------------------------------------
# footnotes
# ---------------------------------------------------------------------------

def _extract_footnotes(raw, root: Tag, paragraphs: list[Paragraph]) -> list[Footnote]:
    if not raw:
        return []
    items: list[tuple[str, dict]] = []
    if isinstance(raw, dict):
        items = [(k, v) for k, v in raw.items() if isinstance(v, dict)]
    elif isinstance(raw, list):
        for i, v in enumerate(raw):
            if isinstance(v, dict):
                items.append((v.get("id") or v.get("noteId") or f"note{i + 1}", v))

    # Which paragraph does each note belong to? Look for its marker in the body.
    note_to_pid: dict[str, str] = {}
    for a in root.select("a.study-note-ref, a[data-scroll-id]"):
        note_id = a.get("data-scroll-id") or (a.get("href") or "").rsplit("#", 1)[-1]
        if not note_id:
            continue
        holder = a
        while holder is not None and not (isinstance(holder, Tag) and holder.name in _UNIT_TAGS and holder.get("id")):
            holder = holder.parent
        if holder is not None:
            note_to_pid.setdefault(note_id, holder.get("id"))

    out: list[Footnote] = []
    for note_id, v in items:
        html = v.get("text") or v.get("html") or ""
        text = _clean(BeautifulSoup(html, "lxml").get_text(" ")) if html else ""
        refs = []
        for r in v.get("referenceUris") or v.get("references") or []:
            if isinstance(r, dict):
                refs.append({k: r[k] for k in ("type", "href", "text") if k in r})
        out.append(
            Footnote(
                note_id=note_id,
                marker=_clean(v.get("marker") or v.get("label") or ""),
                html=html,
                text=text,
                pid=v.get("pid") or note_to_pid.get(note_id),
                refs=refs,
            )
        )
    return out


# ---------------------------------------------------------------------------
# reader html
# ---------------------------------------------------------------------------

_DROP_ATTRS = ("srcset", "sizes", "thumbnail", "poster", "data-video-description")


def _reader_html(root: Tag) -> str:
    node = copy.copy(root)
    for el in node.find_all(["video", "audio", "script", "style", "iframe"]):
        el.decompose()
    for el in node.find_all(True):
        for attr in _DROP_ATTRS:
            if attr in el.attrs:
                del el.attrs[attr]
    if node.name == "body":
        return "".join(str(c) for c in node.contents)
    return str(node)


# ---------------------------------------------------------------------------

def _structured_data(meta: dict) -> dict:
    raw = meta.get("structuredData")
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except (TypeError, ValueError):
        return {}


def _text(el) -> str:
    if el is None:
        return ""
    return _unit_text(el)


def _clean(text) -> str:
    if not text:
        return ""
    if isinstance(text, NavigableString):
        text = str(text)
    text = str(text).replace(" ", " ")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([,.;:!?)\]])", r"\1", text)
    return text
