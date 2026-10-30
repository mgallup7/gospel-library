"""Tables of contents.

A "book" on the site (a scripture volume, one general conference, a manual)
carries a nested table of contents. It is available two ways and this module
reads both into one shape:

* ``reader.bookStore`` inside a page's application state (clean JSON), and
* the ``<nav class="manifest">`` HTML that the content API returns for the
  book's own URI.

The result is a flat, ordered list of ``Node`` objects: sections (which group
things and never hold text) and content pages (which do).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from bs4 import BeautifulSoup

from .fetch import normalize_uri


@dataclass
class Node:
    kind: str  # "section" or "content"
    uri: str | None
    title: str
    subtitle: str | None = None
    depth: int = 0
    order: int = 0
    parent: "Node | None" = field(default=None, repr=False)

    @property
    def section_path(self) -> list[str]:
        """Titles of the enclosing sections, outermost first."""
        titles = []
        p = self.parent
        while p is not None:
            if p.title:
                titles.append(p.title)
            p = p.parent
        return list(reversed(titles))


@dataclass
class Toc:
    uri: str
    title: str
    nodes: list[Node]
    content_type: str | None = None

    @property
    def content_nodes(self) -> list[Node]:
        return [n for n in self.nodes if n.kind == "content"]

    @property
    def sections(self) -> list[Node]:
        return [n for n in self.nodes if n.kind == "section"]


# ---------------------------------------------------------------------------
# From the page state (reader.bookStore)
# ---------------------------------------------------------------------------

def from_state(state: dict, book_uri: str) -> Toc | None:
    store = (state.get("reader") or {}).get("bookStore") or {}
    book_uri = normalize_uri(book_uri)
    book = None
    for key, value in store.items():
        if isinstance(value, dict) and normalize_uri(value.get("uri") or key) == book_uri:
            book = value
            break
    if book is None and store:
        # A page deep inside a book carries that book's store under one key.
        book = next((v for v in store.values() if isinstance(v, dict) and "entries" in v), None)
    if not book:
        return None

    nodes: list[Node] = []
    counter = [0]

    def walk(entries, parent: Node | None, depth: int) -> None:
        for entry in entries or []:
            if not isinstance(entry, dict):
                continue
            if "section" in entry:
                s = entry["section"] or {}
                node = Node(
                    kind="section",
                    uri=normalize_uri(s["uri"]) if s.get("uri") else None,
                    title=_clean(s.get("title")),
                    depth=depth,
                    order=_next(counter),
                    parent=parent,
                )
                nodes.append(node)
                walk(s.get("entries"), node, depth + 1)
            elif "content" in entry:
                c = entry["content"] or {}
                if not c.get("uri"):
                    continue
                uri = normalize_uri(c["uri"])
                if uri == book_uri:
                    continue  # the "Contents" page is the book itself
                nodes.append(
                    Node(
                        kind="content",
                        uri=uri,
                        title=_clean(c.get("title")),
                        subtitle=_clean(c.get("subtitle")) or None,
                        depth=depth,
                        order=_next(counter),
                        parent=parent,
                    )
                )

    walk(book.get("entries"), None, 0)
    return Toc(
        uri=book_uri,
        title=_clean(book.get("title")),
        nodes=nodes,
        content_type=book.get("contentType"),
    )


# ---------------------------------------------------------------------------
# From the content API manifest (<nav class="manifest"><ul class="doc-map">)
# ---------------------------------------------------------------------------

def from_manifest(body_html: str, book_uri: str, title: str = "") -> Toc | None:
    # html.parser keeps the markup as written; lxml would move a <p> out of an
    # <h2>, which is exactly how the site writes its section labels.
    soup = BeautifulSoup(body_html or "", "html.parser")
    nav = soup.select_one("nav.manifest") or soup
    root = nav.select_one("ul.doc-map") or nav.find("ul")
    if root is None:
        return None
    book_uri = normalize_uri(book_uri)
    if not title:
        h1 = soup.find("h1")
        title = _clean(h1.get_text(" ", strip=True)) if h1 else ""

    nodes: list[Node] = []
    counter = [0]

    def walk(ul, parent: Node | None, depth: int) -> None:
        for li in ul.find_all("li", recursive=False):
            sub = li.find("ul", recursive=False)
            if sub is not None:
                label_parts = [
                    c.get_text(" ", strip=True)
                    for c in li.children
                    if getattr(c, "name", None) and c.name not in ("ul", "a")
                ]
                section_title = _clean(" ".join(p for p in label_parts if p))
                section_uri = None
                # Some sections (conference sessions) link to a page of their own,
                # listed as the first tile inside the group with the same title.
                first = sub.find("li", recursive=False)
                first_a = first.find("a", href=True) if first else None
                if first_a is not None and section_title and _clean(_tile_title(first_a)) == section_title:
                    section_uri = normalize_uri(first_a["href"])
                    first.decompose()
                node = Node(kind="section", uri=section_uri, title=section_title, depth=depth, order=_next(counter), parent=parent)
                nodes.append(node)
                walk(sub, node, depth + 1)
                continue
            a = li.find("a", href=True)
            if a is None:
                continue
            uri = normalize_uri(a["href"])
            if uri == book_uri:
                continue
            nodes.append(
                Node(
                    kind="content",
                    uri=uri,
                    title=_clean(_tile_title(a)),
                    subtitle=_clean(_tile_subtitle(a)) or None,
                    depth=depth,
                    order=_next(counter),
                    parent=parent,
                )
            )

    walk(root, None, 0)
    if not nodes:
        return None
    return Toc(uri=book_uri, title=title, nodes=nodes)


# ---------------------------------------------------------------------------
# Library listings (e.g. the general-conference archive, the manuals library)
# ---------------------------------------------------------------------------

def library_entries(state: dict) -> list[Node]:
    """Flatten ``state["library"]`` into content nodes (uri, title, subtitle)."""
    nodes: list[Node] = []
    counter = [0]
    library = state.get("library") or {}
    for key, page in library.items():
        if not isinstance(page, dict):
            continue
        for section in page.get("sections") or []:
            parent = Node(kind="section", uri=None, title=_clean(section.get("title")), order=_next(counter))
            for entry in section.get("entries") or []:
                if not isinstance(entry, dict):
                    continue
                e = entry.get("content") or entry
                if not e.get("uri"):
                    continue
                nodes.append(
                    Node(
                        kind="content",
                        uri=normalize_uri(e["uri"]),
                        title=_clean(e.get("title")),
                        subtitle=_clean(e.get("subtitle")) or None,
                        order=_next(counter),
                        parent=parent,
                    )
                )
    return nodes


# ---------------------------------------------------------------------------

def _tile_title(a) -> str:
    t = a.select_one(".title") or a.find(["p", "h3", "h4", "span"])
    return t.get_text(" ", strip=True) if t is not None else a.get_text(" ", strip=True)


def _tile_subtitle(a) -> str:
    t = a.select_one(".primaryMeta, .subtitle, .author")
    return t.get_text(" ", strip=True) if t is not None else ""


def _clean(text) -> str:
    if not text:
        return ""
    return " ".join(str(text).replace(" ", " ").split())


def _next(counter: list[int]) -> int:
    counter[0] += 1
    return counter[0]
