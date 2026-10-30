"""The shape of the standard works: volumes, books, chapters, names, abbreviations.

Used for three things: knowing which site URIs are scripture chapters, giving
each one a citation like "Alma 32:21", and turning what someone types into the
search box ("alma 32 21", "D&C 76:22-24", "js-h 1:17") into a place to jump to.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache

from .config import RESOURCES


@dataclass(frozen=True)
class Book:
    slug: str
    name: str
    abbrev: str | None
    uri: str
    volume_slug: str
    volume_name: str
    volume_index: int
    book_index: int
    chapters: tuple
    group: str | None

    @property
    def single_chapter(self) -> bool:
        return len(self.chapters) == 1

    def citation(self, chapter: int | str | None = None, verse: int | None = None, verse_end: int | None = None) -> str:
        name = self.short_name
        if chapter is None:
            return name
        if self.slug == "psalms" and chapter is not None:
            name = "Psalm"
        out = f"{name} {chapter}"
        if verse is not None:
            out += f":{verse}"
            if verse_end is not None and verse_end != verse:
                out += f"–{verse_end}"
        return out

    @property
    def short_name(self) -> str:
        if self.slug == "sections":
            return "D&C"
        if self.slug == "official-declarations":
            return "Official Declaration"
        return self.name


@dataclass(frozen=True)
class Reference:
    book: Book
    chapter: int | str | None
    verse: int | None = None
    verse_end: int | None = None

    @property
    def uri(self) -> str:
        if self.chapter is None:
            return f"{self.book.uri}/{self.book.chapters[0]}" if self.book.chapters else self.book.uri
        return f"{self.book.uri}/{self.chapter}"

    @property
    def pid(self) -> str | None:
        return f"p{self.verse}" if self.verse is not None else None

    @property
    def label(self) -> str:
        return self.book.citation(self.chapter if self.chapter is not None else (self.book.chapters[0] if self.book.chapters else None), self.verse, self.verse_end)


_EXTRA_ALIASES = {
    "sections": ["dc", "d&c", "d and c", "d c", "doctrine and covenants", "doctrine & covenants", "section", "sec", "secs", "sections"],
    "official-declarations": ["od", "official declaration", "official declarations", "declaration"],
    "joseph-smith-history": ["js-h", "jsh", "js h", "joseph smith history", "joseph smith-history", "js history", "jsh."],
    "joseph-smith-matthew": ["js-m", "jsm", "js m", "joseph smith matthew", "joseph smith-matthew", "js matthew", "js matt"],
    "articles-of-faith": ["a of f", "aof", "aoff", "articles of faith", "article of faith", "a-of-f"],
    "psalms": ["psalm", "ps", "pss", "psa", "psm"],
    "song-of-solomon": ["song of songs", "song", "sos", "canticles", "song of sol", "solomon's song", "solomons song"],
    "words-of-mormon": ["w of m", "wom", "words of mormon", "w-of-m"],
    "1-nephi": ["1 ne", "1ne", "1 nephi", "first nephi", "1st nephi", "1 nep", "i nephi"],
    "2-nephi": ["2 ne", "2ne", "2 nephi", "second nephi", "2nd nephi", "2 nep", "ii nephi"],
    "3-nephi": ["3 ne", "3ne", "3 nephi", "third nephi", "3rd nephi", "3 nep", "iii nephi"],
    "4-nephi": ["4 ne", "4ne", "4 nephi", "fourth nephi", "4th nephi", "iv nephi"],
    "matthew": ["matt", "mt", "mat"],
    "mark": ["mk", "mrk"],
    "luke": ["lk", "luk"],
    "john": ["jn", "jhn"],
    "revelation": ["rev", "revelations", "apocalypse"],
    "genesis": ["gen", "ge", "gn"],
    "exodus": ["ex", "exo", "exod"],
    "leviticus": ["lev", "lv"],
    "numbers": ["num", "nu", "nm", "numb"],
    "deuteronomy": ["deut", "deu", "dt"],
    "joshua": ["josh", "jos"],
    "judges": ["judg", "jdg", "jgs"],
    "1-samuel": ["1 sam", "1sam", "1 sm", "first samuel"],
    "2-samuel": ["2 sam", "2sam", "2 sm", "second samuel"],
    "1-kings": ["1 kgs", "1kgs", "1 ki", "1 kings", "first kings"],
    "2-kings": ["2 kgs", "2kgs", "2 ki", "2 kings", "second kings"],
    "1-chronicles": ["1 chr", "1chr", "1 chron", "first chronicles"],
    "2-chronicles": ["2 chr", "2chr", "2 chron", "second chronicles"],
    "nehemiah": ["neh"],
    "esther": ["esth", "est"],
    "proverbs": ["prov", "pro", "prv"],
    "ecclesiastes": ["eccl", "ecc", "eccles", "qoheleth"],
    "isaiah": ["isa", "is"],
    "jeremiah": ["jer"],
    "lamentations": ["lam"],
    "ezekiel": ["ezek", "eze", "ezk"],
    "daniel": ["dan", "dn"],
    "hosea": ["hos"],
    "obadiah": ["obad", "ob"],
    "jonah": ["jon"],
    "micah": ["mic"],
    "nahum": ["nah"],
    "habakkuk": ["hab"],
    "zephaniah": ["zeph", "zep"],
    "haggai": ["hag"],
    "zechariah": ["zech", "zec"],
    "malachi": ["mal"],
    "romans": ["rom", "ro"],
    "1-corinthians": ["1 cor", "1cor", "first corinthians"],
    "2-corinthians": ["2 cor", "2cor", "second corinthians"],
    "galatians": ["gal"],
    "ephesians": ["eph"],
    "philippians": ["philip", "phil", "php"],
    "colossians": ["col"],
    "1-thessalonians": ["1 thes", "1 thess", "1thes", "first thessalonians"],
    "2-thessalonians": ["2 thes", "2 thess", "2thes", "second thessalonians"],
    "1-timothy": ["1 tim", "1tim", "first timothy"],
    "2-timothy": ["2 tim", "2tim", "second timothy"],
    "titus": ["tit"],
    "philemon": ["philem", "phlm", "phm"],
    "hebrews": ["heb"],
    "james": ["jas", "jam"],
    "1-peter": ["1 pet", "1pet", "1 pt", "first peter"],
    "2-peter": ["2 pet", "2pet", "2 pt", "second peter"],
    "1-john": ["1 jn", "1jn", "first john"],
    "2-john": ["2 jn", "2jn", "second john"],
    "3-john": ["3 jn", "3jn", "third john"],
    "mosiah": ["mos", "msh"],
    "helaman": ["hel"],
    "mormon": ["morm", "mrm"],
    "ether": ["eth"],
    "moroni": ["moro", "mni"],
    "abraham": ["abr", "abra"],
    "moses": ["mos."],
}


@lru_cache(maxsize=1)
def _load() -> tuple[list[Book], dict[str, Book], dict[str, Book]]:
    data = json.loads((RESOURCES / "scriptures.json").read_text(encoding="utf-8"))
    books: list[Book] = []
    by_slug: dict[str, Book] = {}
    aliases: dict[str, Book] = {}
    for vi, vol in enumerate(data["volumes"]):
        for bi, b in enumerate(vol["books"]):
            book = Book(
                slug=b["slug"],
                name=b["name"],
                abbrev=b.get("abbrev"),
                uri=b["uri"],
                volume_slug=vol["slug"],
                volume_name=vol["name"],
                volume_index=vi,
                book_index=bi,
                chapters=tuple(b.get("chapters") or []),
                group=b.get("group"),
            )
            books.append(book)
            by_slug[book.slug] = book
    for book in books:
        names = {book.name, book.slug.replace("-", " ")}
        if book.abbrev:
            names.add(book.abbrev)
        names.update(_EXTRA_ALIASES.get(book.slug, []))
        if book.volume_slug == "jst-appendix":
            base = book.name.replace("JST,", "").strip()
            names.update({f"jst {base}", f"jst, {base}", base and f"jst-{base}"})
            # jst + the alias list of the underlying book ("jst matt")
            target = book.slug.replace("jst-", "")
            if target in by_slug:
                for alias in _EXTRA_ALIASES.get(target, []) + [by_slug[target].abbrev or ""]:
                    if alias:
                        names.add(f"jst {alias}")
        for n in names:
            key = _norm(n)
            if key and key not in aliases:
                aliases[key] = book
            if key.endswith("."):
                aliases.setdefault(key.rstrip("."), book)
    return books, by_slug, aliases


def books() -> list[Book]:
    return _load()[0]


def book(slug: str) -> Book | None:
    return _load()[1].get(slug)


def book_for_uri(uri: str) -> tuple[Book, str | None] | None:
    """Map '/scriptures/bofm/alma/32' to (Book, '32'); None when not a chapter."""
    uri = uri.split("?")[0]
    for b in books():
        if uri == b.uri:
            return b, None
        if uri.startswith(b.uri + "/"):
            rest = uri[len(b.uri) + 1:]
            if "/" in rest:
                return None
            return b, rest
    return None


def sort_key(uri: str) -> int | None:
    found = book_for_uri(uri)
    if not found:
        return None
    b, chapter = found
    try:
        c = int(str(chapter).split("-")[0]) if chapter else 0
    except ValueError:
        c = 0
    return b.volume_index * 1_000_000 + b.book_index * 1_000 + c


_REF = re.compile(
    r"""^\s*
    (?P<book>(?:[1-4]|i{1,3}|iv|first|second|third|fourth)?\s*[a-z][a-z&.\-—'’ ]*?)
    [\s.,]*
    (?P<chapter>\d{1,3})
    (?:\s*[:.\s]\s*(?P<verse>\d{1,3})(?:\s*[-–—]\s*(?P<verse_end>\d{1,3}))?)?
    \s*$""",
    re.I | re.X,
)
_BOOK_ONLY = re.compile(r"^\s*(?P<book>(?:[1-4]|first|second|third|fourth)?\s*[a-z][a-z&.\-—'’ ]*?)\s*$", re.I)


def parse_reference(query: str) -> Reference | None:
    """Return a Reference when the query reads like a scripture citation."""
    q = query.strip()
    if not q or len(q) > 60:
        return None
    _, _, aliases = _load()
    m = _REF.match(q)
    if m:
        b = aliases.get(_norm(m.group("book")))
        if b is None:
            return None
        chapter = int(m.group("chapter"))
        verse = int(m.group("verse")) if m.group("verse") else None
        verse_end = int(m.group("verse_end")) if m.group("verse_end") else None
        if b.single_chapter and chapter != 1 and verse is None:
            # "Enos 3" means Enos 1:3
            return Reference(b, b.chapters[0] if b.chapters else 1, chapter)
        if b.chapters and chapter not in b.chapters and str(chapter) not in [str(c) for c in b.chapters]:
            return None
        return Reference(b, chapter, verse, verse_end)
    m = _BOOK_ONLY.match(q)
    if m:
        b = aliases.get(_norm(m.group("book")))
        if b is not None and len(_norm(m.group("book"))) >= 3:
            return Reference(b, None)
    return None


def _norm(text: str) -> str:
    text = text.lower().replace("—", "-").replace("–", "-").replace("’", "'")
    text = text.replace("&", " & ")
    text = re.sub(r"[.\s_]+", " ", text).strip()
    text = re.sub(r"\s*-\s*", "-", text)
    text = re.sub(r"\s*&\s*", "&", text)
    text = text.replace("-", " ")
    text = re.sub(r"^(first|1st|i)\s", "1 ", text)
    text = re.sub(r"^(second|2nd|ii)\s", "2 ", text)
    text = re.sub(r"^(third|3rd|iii)\s", "3 ", text)
    text = re.sub(r"^(fourth|4th|iv)\s", "4 ", text)
    text = re.sub(r"^([1-4])([a-z])", r"\1 \2", text)
    return text.strip()
