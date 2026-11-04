"""The Joseph Smith Papers (josephsmithpapers.org), kept beside the library.

The site is a Next.js app; every page carries its data as JSON, and the same
data is served on its own at /_next/data/<build>/paper-summary/<paper>/<n>.json.
That is what this module reads: for each page of a paper, the transcription
("expanded" text, with the editors' bracketed readings), the editorial
footnotes, the people and places it names (with their short biographies),
and the paper's source note and historical introduction.

Catalog: /the-papers/<series> lists the volumes of a series, and
/the-papers/<series>/<volume> lists its papers (and sometimes sub-lists such
as appendix items). Each series becomes a collection ("Joseph Smith Papers:
Journals"), each volume a book, and each paper a document, except that a long
paper (a journal, a history volume, a minute book) becomes one document per
page so the reader is not handed a 300-page scroll.

Manners: one request every JSP_INTERVAL seconds, a plain identifying agent
string, and a time budget per run so the nightly job never spends its whole
night here; what is not reached tonight is fetched on a later night. The
content is Intellectual Reserve's, offered for personal, noncommercial use,
which is what this personal copy is.
"""

from __future__ import annotations

import copy
import hashlib
import json
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup, NavigableString, Tag

from . import config
from .db import Store, now
from .parse import Footnote, Paragraph, ParsedDoc
from .toc import Node

log = logging.getLogger("gospel.jsp")

HOST = "https://www.josephsmithpapers.org"
JSP_INTERVAL = float(__import__("os").environ.get("GOSPEL_LIBRARY_JSP_INTERVAL", "1.2"))
JSP_RECHECK_DAYS = 365
# A paper with more pages than this is stored one document per page.
WHOLE_PAPER_MAX_PAGES = 20
COLLECTION_SORT = 100

# In the order they are worth having: (site path, collection slug, title).
SERIES = [
    ("journals", "jsp-journals", "Journals"),
    ("revelations-and-translations", "jsp-revelations", "Revelations and Translations"),
    ("histories", "jsp-histories", "Histories"),
    ("documents", "jsp-documents", "Documents"),
    ("administrative-records", "jsp-administrative", "Administrative Records"),
    ("legal-records", "jsp-legal", "Legal Records"),
    ("financial-records", "jsp-financial", "Financial Records"),
]
TITLE_PREFIX = "Joseph Smith Papers: "


class JspError(Exception):
    pass


# --------------------------------------------------------------------- fetch --
class JspFetcher:
    """GETs with a gap between them, retries, and the Next.js build id in hand."""

    def __init__(self, *, interval: float = JSP_INTERVAL):
        self.session = requests.Session()
        self.session.headers["User-Agent"] = config.USER_AGENT
        self.session.headers["Accept-Language"] = "en-US,en;q=0.9"
        self.interval = interval
        self._last = 0.0
        self.requests_made = 0
        self.build_id: str | None = None

    def _wait(self) -> None:
        gap = self.interval - (time.monotonic() - self._last)
        if gap > 0:
            time.sleep(gap)
        self._last = time.monotonic()

    def get(self, path: str, *, attempts: int = 4) -> requests.Response:
        url = path if path.startswith("http") else HOST + path
        delay = 3.0
        last: Exception | None = None
        for i in range(attempts):
            self._wait()
            try:
                r = self.session.get(url, timeout=config.TIMEOUT)
                self.requests_made += 1
            except requests.RequestException as exc:
                last = exc
                log.warning("%s: %s (attempt %d)", url, exc, i + 1)
                time.sleep(delay)
                delay *= 2
                continue
            if r.status_code in (429, 500, 502, 503, 504):
                log.warning("%s: HTTP %s (attempt %d)", url, r.status_code, i + 1)
                time.sleep(delay)
                delay *= 2
                continue
            return r
        raise JspError(f"could not fetch {url}: {last}")

    def html_data(self, path: str) -> dict:
        """A page's Next.js data, read out of its HTML."""
        r = self.get(path)
        if r.status_code == 404:
            raise JspError(f"404 {path}")
        r.raise_for_status()
        data = next_data(r.text)
        if data is None:
            raise JspError(f"no page data in {path}")
        if data.get("buildId"):
            self.build_id = data["buildId"]
        return data

    def page_props(self, path: str) -> dict:
        """pageProps for a site path, through the JSON route when the build id
        is known (a third of the bytes), through the HTML otherwise."""
        if self.build_id:
            r = self.get(f"/_next/data/{self.build_id}/{path.strip('/')}.json")
            if r.status_code == 200 and r.headers.get("Content-Type", "").startswith("application/json"):
                try:
                    return r.json()["pageProps"]
                except (ValueError, KeyError):
                    pass
            elif r.status_code == 404:
                # a new deployment: the build id changed, or the page is gone
                self.build_id = None
        return self.html_data(path)["props"]["pageProps"]


_NEXT_DATA = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)


def next_data(html: str) -> dict | None:
    m = _NEXT_DATA.search(html)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except ValueError:
        return None


# ------------------------------------------------------------------- catalog --
@dataclass
class Paper:
    slug: str
    title: str


@dataclass
class Volume:
    id: str          # jsppj1
    path: str        # /the-papers/journals/jsppj1
    title: str
    papers: list[Paper] = field(default_factory=list)


def _links_of(page_props: dict) -> list[dict]:
    panes = (page_props.get("docDetails") or {}).get("panes") or []
    if not panes:
        return []
    out = []
    for section in panes[-1].get("sections") or []:
        out.extend(section.get("links") or [])
    return out


def _clean_title(text: str) -> str:
    t = BeautifulSoup(text or "", "html.parser").get_text(" ")
    return re.sub(r"\s+", " ", t).strip()


def volumes_of(fetcher: JspFetcher, series_path: str) -> list[Volume]:
    """The volumes a series lists, in the site's order."""
    props = fetcher.page_props(f"/the-papers/{series_path}")
    out = []
    for link in _links_of(props):
        href = (link.get("href") or "").strip()
        if not href.startswith(f"/the-papers/{series_path}/"):
            continue
        vid = link.get("documentSeriesId") or href.rsplit("/", 1)[-1]
        text = link.get("text")
        if not text and isinstance(link.get("title"), dict):
            text = link["title"].get("text")
        out.append(Volume(id=vid, path=href, title=_clean_title(text or vid)))
    return out


def papers_of(fetcher: JspFetcher, volume_path: str, *, depth: int = 0) -> list[Paper]:
    """The papers under a volume page, sub-lists (appendix items) included."""
    props = fetcher.page_props(volume_path)
    out: list[Paper] = []
    seen = set()
    for link in _links_of(props):
        href = (link.get("href") or "").strip()
        if href.startswith("/paper-summary/"):
            slug = href.split("/paper-summary/", 1)[1].split("/")[0].split("?")[0]
            if slug and slug not in seen:
                seen.add(slug)
                out.append(Paper(slug=slug, title=_clean_title(link.get("text") or "")))
        elif href.startswith("/the-papers/") and href != volume_path and depth < 2:
            for p in papers_of(fetcher, href, depth=depth + 1):
                if p.slug not in seen:
                    seen.add(p.slug)
                    out.append(p)
    return out


# --------------------------------------------------------------------- pages --
def page_summary(fetcher: JspFetcher, slug: str, page: int) -> dict:
    props = fetcher.page_props(f"/paper-summary/{slug}/{page}")
    summary = props.get("summary")
    if not summary or not isinstance(summary, dict):
        raise JspError(f"no summary for {slug}/{page}")
    summary = dict(summary)
    summary["_toc"] = props.get("tableOfContents") or []
    summary["_gallery"] = props.get("gallery") or []
    return summary


# ------------------------------------------------------------------ cleaning --
_INLINE_MAP = {"deleted": "s", "underscore": "u", "italic": "i", "bold": "b", "superscript": "sup", "subscript": "sub"}


@dataclass
class Cleaned:
    html: str
    paragraphs: list[Paragraph]
    footnotes: list[Footnote]
    next_pid: int = 1


def clean_transcript(html: str, *, pid_start: int = 1, page_label: str | None = None, notes_seen: dict | None = None) -> Cleaned:
    """The site's transcription markup as reader HTML: one <p id=pN> per block,
    editorial notes as footnote markers, people and places as taps that show
    their short biographies, the manuscript's deletions and insertions kept."""
    soup = BeautifulSoup(html or "", "html.parser")
    body = soup.body or soup
    footnotes: list[Footnote] = []
    notes_seen = notes_seen if notes_seen is not None else {}

    # editorial notes and name popups
    for aside in list(body.select("aside.popup-wrapper")):
        a = aside.find("a")
        classes = (a.get("class") or []) if isinstance(a, Tag) else []
        if a is None:
            aside.decompose()
            continue
        if "editorial-note-static" in classes or "new-scribe-note" in classes:
            number = re.sub(r"\s+", "", a.get_text()) or str(len(footnotes) + 1)
            note = aside.select_one(".note-data")
            note_html = "".join(str(c) for c in note.contents if not (isinstance(c, Tag) and c.name == "hr")) if note else ""
            note_id = f"n{number}" if "editorial-note-static" in classes else f"scribe{number}"
            marker = soup.new_tag("a", attrs={"class": "study-note-ref", "href": f"#{note_id}"})
            sup = soup.new_tag("sup", attrs={"class": "marker"})
            sup.string = number
            marker.append(sup)
            aside.replace_with(marker)
            footnotes.append(Footnote(note_id=note_id, marker=number, html=_absolute_links(note_html), text=_text_of(note_html), pid=None))
        elif "reference" in classes:
            ro = a.get("ro") or a.get("person") or a.get("place") or ""
            title = a.get("title") or a.get_text()
            bio = aside.select_one(".note-data p")
            name = soup.new_tag("a", attrs={"class": "study-note-ref jsp-ref", "href": f"#{ro or 'ref'}"})
            name.string = a.get_text()
            aside.replace_with(name)
            if ro and ro not in notes_seen:
                notes_seen[ro] = True
                more_a = aside.select_one("a.more")
                more = f'<p><a class="jsp-link" href="{HOST}{more_a.get("href")}">{_esc(more_a.get_text(strip=True) or "More")} (josephsmithpapers.org)</a></p>' if more_a is not None and (more_a.get("href") or "").startswith("/") else ""
                footnotes.append(Footnote(note_id=ro, marker="", html=f"<p><b>{_esc(title)}</b></p>{str(bio) if bio else ''}{more}", text=_text_of(str(bio) if bio else ""), pid=None))
        else:
            aside.replace_with(NavigableString(a.get_text()))

    # inline styling to plain tags
    for span in list(body.find_all("span")):
        classes = span.get("class") or []
        if "line-break" in classes:
            span.replace_with(NavigableString("" if "hyphenate" in classes else " "))
            continue
        tag = next((_INLINE_MAP[c] for c in classes if c in _INLINE_MAP), None)
        if tag:
            span.name = tag
            span.attrs = {}
        elif "illegible" in classes or "editorial-comment" in classes or "anonymous-block" in classes:
            span.attrs = {"class": "ed" if "editorial-comment" in classes else "illegible" if "illegible" in classes else "entry"}
        else:
            span.unwrap()
    for a in list(body.find_all("a")):
        if "study-note-ref" in (a.get("class") or []):
            continue
        href = a.get("href") or ""
        if a.get("name") and not href:
            a.unwrap()
            continue
        if href.startswith("/"):
            a.attrs = {"href": HOST + href, "class": "jsp-link"}
        elif href.startswith("http"):
            a.attrs = {"href": href, "class": "jsp-link"}
        else:
            a.unwrap()
    for el in list(body.find_all(["input", "script", "style", "hr", "img"])):
        el.decompose()

    # blocks
    paragraphs: list[Paragraph] = []
    out: list[str] = []
    n = pid_start
    if page_label:
        out.append(f'<div class="jsp-page">[p. {_esc(page_label)}]</div>')
    blocks = [c for c in body.contents if isinstance(c, Tag) or (isinstance(c, NavigableString) and c.strip())]
    for blk in blocks:
        if isinstance(blk, NavigableString):
            text = _clean_ws(str(blk))
            if not text:
                continue
            pid = f"p{n}"
            n += 1
            out.append(f'<p id="{pid}" class="jsp">{_esc(text)}</p>')
            paragraphs.append(Paragraph(seq=len(paragraphs) + 1, pid=pid, kind="para", text=text))
            continue
        classes = blk.get("class") or []
        if blk.name == "table":
            text = _clean_ws(blk.get_text(" "))
            pid = f"p{n}"
            n += 1
            blk.attrs = {"id": pid, "class": "jsp"}
            out.append(str(blk))
            if text:
                paragraphs.append(Paragraph(seq=len(paragraphs) + 1, pid=pid, kind="para", text=text))
            continue
        is_heading = "journal-entry-divider" in classes
        text = _clean_ws(_text_without_markers(blk))
        if not text and not blk.find(True):
            continue
        pid = f"p{n}"
        n += 1
        align = next((c for c in ("center", "right", "noindent", "indent", "hanging") if c in classes), "")
        inner = re.sub(r"[ \t]{2,}", " ", "".join(str(c) for c in blk.contents)).strip()
        if is_heading:
            out.append(f'<h3 id="{pid}" class="jsp-entry">{inner}</h3>')
            paragraphs.append(Paragraph(seq=len(paragraphs) + 1, pid=pid, kind="heading", text=text))
        else:
            out.append(f'<p id="{pid}" class="jsp{(" " + align) if align else ""}">{inner}</p>')
            if text:
                paragraphs.append(Paragraph(seq=len(paragraphs) + 1, pid=pid, kind="para", text=text))
    # which paragraph each note sits in
    for i, chunk in enumerate(out):
        for m in re.finditer(r'href="#([^"]+)"', chunk):
            nid = m.group(1)
            for fn in footnotes:
                if fn.note_id == nid and fn.pid is None:
                    pm = re.search(r'id="(p\d+)"', chunk)
                    fn.pid = pm.group(1) if pm else None
    return Cleaned(html="".join(out), paragraphs=paragraphs, footnotes=footnotes, next_pid=n)


def _text_without_markers(el: Tag) -> str:
    c = copy.copy(el)
    for sup in c.select("sup.marker"):
        sup.decompose()
    return c.get_text(" ")


def _text_of(html: str) -> str:
    return _clean_ws(BeautifulSoup(html or "", "html.parser").get_text(" "))


def _clean_ws(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").replace(" ,", ",").replace(" .", ".").strip()


def _esc(s: str) -> str:
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _absolute_links(html: str) -> str:
    return re.sub(r'href="(/[^"]*)"', lambda m: f'href="{HOST}{m.group(1)}"', html or "")


def clean_prose(html: str, *, pid_start: int = 1) -> Cleaned:
    """A source note or historical introduction: ordinary paragraphs with the
    same notes and name popups."""
    return clean_transcript(html, pid_start=pid_start)


# ----------------------------------------------------------------- documents --
def _year_of(date: str | None) -> int | None:
    m = re.search(r"\b(1[6-9]\d\d)\b", date or "")
    return int(m.group(1)) if m else None


def _hash(html: str) -> str:
    return hashlib.sha256(html.encode("utf-8")).hexdigest()


def _header(title: str, summary: dict, *, subtitle: str | None = None) -> str:
    bits = [f"<header><h1 id=\"title1\">{_esc(title)}</h1>"]
    if subtitle:
        bits.append(f'<p class="subtitle">{_esc(subtitle)}</p>')
    meta = [summary.get("date") or "", summary.get("handwriting") or ""]
    meta = [m for m in meta if m]
    if meta:
        bits.append(f'<p class="jsp-meta">{" · ".join(_esc(m) for m in meta)}</p>')
    bits.append("</header>")
    return "".join(bits)


def _foot(summary: dict, slug: str, page: int | None) -> str:
    url = f"{HOST}/paper-summary/{slug}/{page or 1}"
    return f'<p class="jsp-credit">From <a class="jsp-link" href="{url}">The Joseph Smith Papers</a>, © Intellectual Reserve, Inc.; this copy is for personal study.</p>'


def paper_documents(summaries: list[dict], slug: str, paper_title: str, *, whole: bool) -> list[ParsedDoc]:
    """ParsedDocs for a paper: one for the whole paper or one per page, plus a
    source note and a historical introduction when the site has them."""
    docs: list[ParsedDoc] = []
    first = summaries[0]
    title = _clean_title(first.get("cleanEditorialTitle") or first.get("editorialTitle") or paper_title) or paper_title
    date = first.get("date") or None
    labels = {int(g.get("page") or 0): g.get("label") or "" for g in first.get("_gallery") or []}
    notes_seen: dict = {}
    if whole:
        parts, paragraphs, footnotes, n = [], [], [], 1
        for s in summaries:
            page = int(s.get("requestedPageNumber") or 1)
            c = clean_transcript(s.get("expandedText") or s.get("clearText") or "", pid_start=n, page_label=labels.get(page) if len(summaries) > 1 else None, notes_seen=notes_seen)
            n = c.next_pid
            parts.append(c.html)
            paragraphs.extend(c.paragraphs)
            footnotes.extend(c.footnotes)
        for i, p in enumerate(paragraphs, start=1):
            p.seq = i
        body = _header(title, first) + '<div class="body-block">' + "".join(parts) + "</div>" + _foot(first, slug, None)
        docs.append(ParsedDoc(uri=f"/paper-summary/{slug}", title=title, subtitle=None, author=None, author_role=None, kicker=None, date=date,
                              content_type="jsp-paper", body_html=body, paragraphs=paragraphs, footnotes=footnotes,
                              word_count=sum(len(p.text.split()) for p in paragraphs), content_hash=_hash(body), description=first.get("handwriting") or None))
    else:
        for s in summaries:
            page = int(s.get("requestedPageNumber") or 1)
            label = labels.get(page) or str(page)
            c = clean_transcript(s.get("expandedText") or s.get("clearText") or "", notes_seen={})
            ptitle = f"{title}, page {label}"
            body = _header(ptitle, s) + '<div class="body-block">' + c.html + "</div>" + _foot(s, slug, page)
            docs.append(ParsedDoc(uri=f"/paper-summary/{slug}/{page}", title=ptitle, subtitle=None, author=None, author_role=None, kicker=None,
                                  date=s.get("date") or date, content_type="jsp-page", body_html=body, paragraphs=c.paragraphs, footnotes=c.footnotes,
                                  word_count=sum(len(p.text.split()) for p in c.paragraphs), content_hash=_hash(body), description=s.get("handwriting") or None))
    for key, name, suffix in (("sourceNotes", "Source Note", "source-note"), ("historicalIntro", "Historical Introduction", "introduction")):
        block = first.get(key)
        html = block.get("text") if isinstance(block, dict) else (block if isinstance(block, str) else "")
        if not html or not _text_of(html):
            continue
        c = clean_prose(html)
        if not c.paragraphs:
            continue
        dtitle = f"{name}: {title}"
        body = _header(dtitle, first) + '<div class="body-block">' + c.html + "</div>" + _foot(first, slug, None)
        docs.append(ParsedDoc(uri=f"/paper-summary/{slug}/{suffix}", title=dtitle, subtitle=None, author=None, author_role=None, kicker=name, date=date,
                              content_type=f"jsp-{suffix}", body_html=body, paragraphs=c.paragraphs, footnotes=c.footnotes,
                              word_count=sum(len(p.text.split()) for p in c.paragraphs), content_hash=_hash(body)))
    return docs


def _node(title: str, uri: str | None, order: int, path: list[str], *, kind: str = "content") -> Node:
    """A table-of-contents node under a chain of section titles."""
    parent = None
    for depth, t in enumerate(path):
        parent = Node(kind="section", uri=None, title=t, depth=depth, order=0, parent=parent)
    return Node(kind=kind, uri=uri, title=title, depth=len(path), order=order, parent=parent)


# ---------------------------------------------------------------------- sync --
class JspSync:
    """Fetch what is missing, a little each night, within a time budget."""

    def __init__(self, store: Store, fetcher: JspFetcher | None = None, *, minutes: float = 75, catalog_days: float = 7):
        self.store = store
        self.fetcher = fetcher or JspFetcher()
        self.minutes = minutes
        self.catalog_days = catalog_days
        self.counts = {"papers": 0, "pages": 0, "documents": 0, "errors": 0, "requests": 0}
        self._deadline = 0.0

    def out_of_time(self) -> bool:
        return time.monotonic() >= self._deadline

    def run(self, series: list[str] | None = None) -> dict:
        self._deadline = time.monotonic() + self.minutes * 60
        done = self.store.get_meta("jsp_papers", {}) or {}
        stopped = False
        for i, (path, slug, title) in enumerate(SERIES):
            if series and path not in series and slug not in series:
                continue
            if self.out_of_time():
                stopped = True
                break
            cid = self.store.collection_id(slug, TITLE_PREFIX + title, "jsp", COLLECTION_SORT + i)
            try:
                volumes = self.catalog(cid, path)
            except Exception as exc:  # noqa: BLE001
                log.warning("catalog of %s: %s", path, exc)
                self.counts["errors"] += 1
                continue
            for v_i, vol in enumerate(volumes):
                book_id = self.store.book_id(cid, vol.path, vol.title, content_type="jsp-volume", sort=v_i)
                for p_i, paper in enumerate(vol.papers):
                    if self.out_of_time():
                        stopped = True
                        break
                    if self._have(done.get(paper.slug)):
                        continue
                    try:
                        info = self.fetch_paper(cid, book_id, paper, sort_base=p_i * 1000, section=[TITLE_PREFIX + title, vol.title])
                    except Exception as exc:  # noqa: BLE001
                        log.warning("%s: %s", paper.slug, exc)
                        self.counts["errors"] += 1
                        done[paper.slug] = {"error": str(exc)[:200], "at": now()}
                        self.store.set_meta("jsp_papers", done)
                        continue
                    done[paper.slug] = info
                    self.store.set_meta("jsp_papers", done)
                    self.counts["papers"] += 1
                if stopped:
                    break
            if stopped:
                break
        self.counts["requests"] = self.fetcher.requests_made
        if self.counts["documents"]:
            self.store.optimize()
        self.store.set_meta("jsp_last", {"finished": now(), "stopped": stopped, **self.counts})
        log.info("Joseph Smith Papers: %s%s", self.counts, " (time budget reached)" if stopped else "")
        return dict(self.counts)

    @staticmethod
    def _have(entry: dict | None) -> bool:
        """Fetched already; a paper that failed is tried again after a few days."""
        if not entry:
            return False
        if "error" not in entry:
            return True
        try:
            at = datetime.strptime(entry.get("at", ""), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        except ValueError:
            return False
        return (datetime.now(timezone.utc) - at).days < 3

    # The volumes and papers of a series, refreshed every catalog_days.
    def catalog(self, cid: int, path: str) -> list[Volume]:
        key = f"jsp_catalog:{path}"
        cached = self.store.get_meta(key)
        if cached and cached.get("checked") and (datetime.now(timezone.utc) - datetime.strptime(cached["checked"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)).days < self.catalog_days:
            return [Volume(id=v["id"], path=v["path"], title=v["title"], papers=[Paper(**p) for p in v["papers"]]) for v in cached["volumes"]]
        volumes = volumes_of(self.fetcher, path)
        for vol in volumes:
            vol.papers = papers_of(self.fetcher, vol.path)
            log.info("%s: %d papers", vol.title, len(vol.papers))
        self.store.set_meta(key, {"checked": now(), "volumes": [{"id": v.id, "path": v.path, "title": v.title, "papers": [{"slug": p.slug, "title": p.title} for p in v.papers]} for v in volumes]})
        for v_i, vol in enumerate(volumes):
            book_id = self.store.book_id(cid, vol.path, vol.title, content_type="jsp-volume", sort=v_i)
            nodes = [_node(p.title, f"/paper-summary/{p.slug}", i, [vol.title]) for i, p in enumerate(vol.papers)]
            self.store.record_toc(book_id, nodes, next_check_days=self.catalog_days)
        return volumes

    def fetch_paper(self, cid: int, book_id: int, paper: Paper, *, sort_base: int, section: list[str]) -> dict:
        first = page_summary(self.fetcher, paper.slug, 1)
        pages = int(first.get("numberOfPages") or 1)
        summaries = [first]
        for n in range(2, pages + 1):
            summaries.append(page_summary(self.fetcher, paper.slug, n))
        whole = pages <= WHOLE_PAPER_MAX_PAGES
        docs = paper_documents(summaries, paper.slug, paper.title, whole=whole)
        year = _year_of(first.get("date"))
        for i, doc in enumerate(docs):
            inside = not whole or i > 0  # a page, a source note or an introduction sits under the paper's own title
            node = _node(doc.title, doc.uri, sort_base + i, section + ([paper.title] if inside else []))
            self.store.save_document(collection_id=cid, book_id=book_id, doc=doc, node=node,
                                     extra={"title": doc.title, "year": year, "sort_key": sort_base + i, "date": doc.date})
            self.counts["documents"] += 1
        self._long_recheck(docs)
        self.counts["pages"] += pages
        return {"pages": pages, "mode": "whole" if whole else "pages", "docs": len(docs), "at": now(), "title": paper.title}

    def _long_recheck(self, docs: list[ParsedDoc]) -> None:
        # The papers change rarely; the nightly recheck of the Church's pages
        # must not spend its budget here.
        uris = [d.uri for d in docs]
        self.store.conn.executemany("UPDATE documents SET next_check=?, check_interval=? WHERE uri=?",
                                    [(_in_days(JSP_RECHECK_DAYS), JSP_RECHECK_DAYS, u) for u in uris])
        self.store.conn.commit()


def _in_days(days: float) -> str:
    from .db import in_days
    return in_days(days)
