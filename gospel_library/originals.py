"""The Bible in its original languages, word by word, beside the KJV.

Source: the STEP Bible data from Tyndale House, Cambridge (CC BY 4.0,
https://github.com/STEPBible/STEPBible-Data): the Hebrew Bible (Leningrad
Codex) and the Greek New Testament (every word of NA28, the Textus Receptus
behind the KJV, SBLGNT, Westcott-Hort, Tregelles and the Byzantine text),
each word tagged with a transliteration, an English gloss, a Strong's
number and its grammar; and the brief lexicons that go with the numbers.

The data lands in the library database as three tables:

* ``original_words``   one row per word, in verse order, with the KJV
                       reference (the data's English versification; Psalm
                       titles are verse 0)
* ``original_verses``  an FTS5 table per verse: the words without vowel
                       points or accents, the transliterations, the Strong's
                       numbers and the glosses, so Hebrew, Greek and Strong's
                       numbers can be searched
* ``original_lexicon`` one row per Strong's number (extended and plain)

Credit, as the licence asks: "STEP Bible" linked to www.STEPBible.org, with
https://STEPBible.github.io/STEPBible-Data as the source.
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
import unicodedata
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

from . import config

log = logging.getLogger("gospel.originals")

RAW = "https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master/"
FILES = {
    "hebrew": [
        "Translators Amalgamated OT+NT/TAHOT Gen-Deu - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt",
        "Translators Amalgamated OT+NT/TAHOT Jos-Est - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt",
        "Translators Amalgamated OT+NT/TAHOT Job-Sng - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt",
        "Translators Amalgamated OT+NT/TAHOT Isa-Mal - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt",
    ],
    "greek": [
        "Translators Amalgamated OT+NT/TAGNT Mat-Jhn - Translators Amalgamated Greek NT - STEPBible.org CC-BY.txt",
        "Translators Amalgamated OT+NT/TAGNT Act-Rev - Translators Amalgamated Greek NT - STEPBible.org CC-BY.txt",
    ],
    "lexicon_hebrew": ["Lexicons/TBESH - Translators Brief lexicon of Extended Strongs for Hebrew - STEPBible.org CC BY.txt"],
    "lexicon_greek": ["Lexicons/TBESG - Translators Brief lexicon of Extended Strongs for Greek - STEPBible.org CC BY.txt"],
    "morph_hebrew": ["Morphology codes/TEHMC - Translators Expansion of Hebrew Morphology Codes - STEPBible.org CC BY.txt"],
    "morph_greek": ["Morphology codes/TEGMC - Translators Expansion of Greek Morphhology Codes - STEPBible.org CC BY.txt"],
}

# Bumped whenever the tables or the way they are filled change, so a library
# loaded by an older version of this module is reloaded by the next sync.
FORMAT = 3

# STEP's three-letter book codes to the library's book slugs.
BOOKS = {
    "Gen": "genesis", "Exo": "exodus", "Lev": "leviticus", "Num": "numbers", "Deu": "deuteronomy", "Jos": "joshua", "Jdg": "judges",
    "Rut": "ruth", "1Sa": "1-samuel", "2Sa": "2-samuel", "1Ki": "1-kings", "2Ki": "2-kings", "1Ch": "1-chronicles", "2Ch": "2-chronicles",
    "Ezr": "ezra", "Neh": "nehemiah", "Est": "esther", "Job": "job", "Psa": "psalms", "Pro": "proverbs", "Ecc": "ecclesiastes",
    "Sng": "song-of-solomon", "Isa": "isaiah", "Jer": "jeremiah", "Lam": "lamentations", "Ezk": "ezekiel", "Dan": "daniel", "Hos": "hosea",
    "Jol": "joel", "Amo": "amos", "Oba": "obadiah", "Jon": "jonah", "Mic": "micah", "Nam": "nahum", "Hab": "habakkuk", "Zep": "zephaniah",
    "Hag": "haggai", "Zec": "zechariah", "Mal": "malachi",
    "Mat": "matthew", "Mrk": "mark", "Luk": "luke", "Jhn": "john", "Act": "acts", "Rom": "romans", "1Co": "1-corinthians", "2Co": "2-corinthians",
    "Gal": "galatians", "Eph": "ephesians", "Php": "philippians", "Col": "colossians", "1Th": "1-thessalonians", "2Th": "2-thessalonians",
    "1Ti": "1-timothy", "2Ti": "2-timothy", "Tit": "titus", "Phm": "philemon", "Heb": "hebrews", "Jas": "james", "1Pe": "1-peter",
    "2Pe": "2-peter", "1Jn": "1-john", "2Jn": "2-john", "3Jn": "3-john", "Jud": "jude", "Rev": "revelation",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS original_words(
  id INTEGER PRIMARY KEY,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  lang TEXT NOT NULL,
  word TEXT NOT NULL,
  translit TEXT,
  gloss TEXT,
  strongs TEXT,
  root TEXT,
  morph TEXT,
  tags TEXT,
  flags TEXT
);
CREATE INDEX IF NOT EXISTS original_words_ref ON original_words(book, chapter, verse, seq);
CREATE INDEX IF NOT EXISTS original_words_root ON original_words(root);
CREATE INDEX IF NOT EXISTS original_words_strongs ON original_words(strongs);
-- The searchable form of each verse. Contentless: the index alone, with the
-- reference kept in original_verse_refs under the same rowid.
CREATE VIRTUAL TABLE IF NOT EXISTS original_verses USING fts5(
  plain, translit, strongs, glosses, content='', tokenize='unicode61 remove_diacritics 0'
);
CREATE TABLE IF NOT EXISTS original_verse_refs(
  id INTEGER PRIMARY KEY,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  lang TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS original_verse_refs_ref ON original_verse_refs(book, chapter, verse);
CREATE TABLE IF NOT EXISTS original_lexicon(
  strongs TEXT PRIMARY KEY,
  base TEXT,
  lang TEXT NOT NULL,
  lemma TEXT,
  translit TEXT,
  type TEXT,
  gloss TEXT,
  definition TEXT,
  relation TEXT
);
CREATE INDEX IF NOT EXISTS original_lexicon_base ON original_lexicon(base);
-- What each grammar code means, in words (STEP's expansions of the codes).
CREATE TABLE IF NOT EXISTS original_morph(
  code TEXT PRIMARY KEY,
  lang TEXT NOT NULL,
  parse TEXT,
  short TEXT,
  meaning TEXT,
  example TEXT
);
"""

_REF = re.compile(r"^([1-3]?[A-Za-z]{2,3})\.(\d+)\.(\d+)")
_HEB_MARKS = re.compile(r"[֑-ֽֿ-ׇ]")  # points, cantillation, meteg; keep the letters and the maqaf
_GREEK_MARKS = None  # handled by Unicode decomposition


def strip_marks(text: str, lang: str) -> str:
    """Letters only: Hebrew without points, Greek without accents or breathings."""
    if lang == "he":
        t = _HEB_MARKS.sub("", text).replace("־", " ").replace("׃", "").replace("׀", " ")
        return re.sub(r"\s+", " ", t).strip()
    t = unicodedata.normalize("NFD", text)
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = unicodedata.normalize("NFC", t).replace("ς", "σ")
    return re.sub(r"[^\w\s]", " ", t).strip()


def ascii_translit(text: str) -> str:
    """A transliteration as someone would type it: letters only, no macrons or dots ("agapē" -> "agape")."""
    t = unicodedata.normalize("NFD", text or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"[^A-Za-z]", "", t).lower()


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)


def download(dest: Path) -> Path:
    """Fetch the data files from GitHub into dest (skipping ones already there)."""
    import requests

    dest.mkdir(parents=True, exist_ok=True)
    for group in FILES.values():
        for rel in group:
            target = dest / Path(rel).name
            if target.exists() and target.stat().st_size > 1000:
                continue
            url = RAW + urllib.parse.quote(rel)
            log.info("downloading %s", rel)
            r = requests.get(url, timeout=300)
            r.raise_for_status()
            target.write_bytes(r.content)
    return dest


def _files(source: Path, group: str) -> list[Path]:
    out = []
    for rel in FILES[group]:
        p = source / Path(rel).name
        if not p.exists():
            p = source / rel
        if not p.exists():
            raise FileNotFoundError(f"{Path(rel).name} is not in {source}")
        out.append(p)
    return out


def _ref(cell: str) -> tuple[str, int, int, int, str] | None:
    """'Psa.3.0(3.1)#01=L' -> (slug, chapter, verse, order, flags).

    The reference is the English one (the KJV's where the data marks a
    difference in square brackets). When one KJV verse gathers words from
    more than one source verse (Psalm titles that run two Hebrew verses,
    a KJV verse that holds NRSV 14 and 15), the order keeps the source
    verse first and the word number second, so the words stay in sequence.
    """
    head, _, rest = cell.partition("#")
    m = _REF.match(head)
    if not m:
        return None
    slug = BOOKS.get(m.group(1))
    if not slug:
        return None
    chapter, verse = int(m.group(2)), int(m.group(3))
    source_verse = verse
    kjv = re.search(r"\[(\d+)\.(\d+)\]", head)
    if kjv:
        chapter, verse = int(kjv.group(1)), int(kjv.group(2))
    heb = re.search(r"\((\d+)\.(\d+)\)", head)
    if heb:
        source_verse = int(heb.group(2))
    num, _, flags = rest.partition("=")
    try:
        n = int(num)
    except ValueError:
        return None
    return slug, chapter, verse, source_verse * 1000 + n, flags.strip()


def parse_hebrew(path: Path):
    """Yield one dict per Hebrew word (the text translators use: L, Q, R, X; variants are skipped)."""
    with path.open(encoding="utf-8-sig") as f:
        for line in f:
            if not line.strip() or line.startswith("#") or line.startswith("\t") or line.startswith("="):
                continue
            cols = line.rstrip("\n").split("\t")
            if len(cols) < 6:
                continue
            ref = _ref(cols[0])
            if not ref:
                continue
            slug, chapter, verse, n, flags = ref
            kind = flags.split("(")[0]
            if not kind or kind[0] not in "LQRX":
                continue
            hebrew = cols[1]
            word = hebrew.replace("/", "").replace("\\", "")
            translit = cols[2].replace("/", "").strip()
            gloss = cols[3].replace("/ ", " ").replace("/", " ").strip()
            dstrongs = cols[4]
            tags = [t for t in re.split(r"[/\\]", dstrongs) if t]
            root = next((t.strip("{}") for t in tags if t.startswith("{")), None)
            strongs = [t.strip("{}") for t in tags if re.match(r"^\{?H\d{4}[A-Za-z]?\}?$", t) and not t.strip("{}").startswith("H90")]
            morph = cols[5].strip()
            expanded = cols[11].strip() if len(cols) > 11 else ""
            yield dict(book=slug, chapter=chapter, verse=verse, seq=n, lang="he", word=word, translit=translit, gloss=gloss,
                       strongs=" ".join(strongs), root=root, morph=morph, tags=expanded.replace("\\", " "), flags=kind)


def parse_greek(path: Path):
    """Yield one dict per Greek word found in the Nestle-Aland or the KJV's Greek (editions marked)."""
    with path.open(encoding="utf-8-sig") as f:
        for line in f:
            if not line.strip() or line.startswith("#") or line.startswith("\t") or line.startswith("="):
                continue
            cols = line.rstrip("\n").split("\t")
            if len(cols) < 6:
                continue
            ref = _ref(cols[0])
            if not ref:
                continue
            slug, chapter, verse, n, flags = ref
            if not re.search(r"[NKnk]", flags):
                continue  # words found only in other editions
            m = re.match(r"^(.*?)\s*\(([^)]*)\)\s*$", cols[1].strip())
            word, translit = (m.group(1), m.group(2)) if m else (cols[1].strip(), "")
            word = word.replace("¶", "").strip()  # STEP marks paragraph ends on the word; the text does not need it
            gloss = cols[2].strip()
            sm = re.match(r"^([GH]\d{4}[A-Za-z]?)(?:=(.*))?$", cols[3].strip())
            strongs = sm.group(1) if sm else cols[3].split("=")[0].strip()
            morph = (sm.group(2) or "").strip() if sm else ""
            editions = cols[5].strip() if len(cols) > 5 else ""
            # the editions are worth keeping only where they differ: a word in every edition is the norm
            tags = "" if flags == "NKO" else editions
            yield dict(book=slug, chapter=chapter, verse=verse, seq=n, lang="gr", word=word, translit=translit, gloss=gloss,
                       strongs=strongs, root=strongs, morph=morph, tags=tags, flags=flags)


def parse_lexicon(path: Path, lang: str):
    """Yield one dict per entry: extended Strong's number, lemma, transliteration, type, gloss, definition."""
    with path.open(encoding="utf-8-sig") as f:
        for line in f:
            cols = line.rstrip("\n").split("\t")
            if len(cols) < 7 or not re.match(r"^[GH]\d{4}", cols[0]):
                continue
            base = cols[0].strip()[:5]  # the plain Strong's number; "H2617a" and "H2617b" are two senses of H2617
            dpart = cols[1].strip()
            dm = re.match(r"^([GH]\d{4}[A-Za-z]?)\s*=?\s*(.*)$", dpart)
            ext = dm.group(1) if dm else base
            relation = (dm.group(2) or "").strip() if dm else ""
            yield dict(strongs=ext, base=base, lang=lang, lemma=cols[3].strip(), translit=cols[4].strip(), type=cols[5].strip(),
                       gloss=cols[6].strip(), definition=(cols[7].strip() if len(cols) > 7 else ""), relation=relation)


def parse_morph(path: Path, lang: str):
    """Yield one dict per grammar code from STEP's expansion files.

    After the introduction, each code is a block that starts with a "$" line:
    the code and its parse, then a short phrase, a plain-English meaning and
    an example, one per line.
    """
    with path.open(encoding="utf-8-sig") as f:
        lines = [ln.rstrip("\n") for ln in f]
    i = 0
    while i < len(lines):
        if lines[i].strip() != "$":
            i += 1
            continue
        block = []
        i += 1
        while i < len(lines) and lines[i].strip() != "$":
            block.append(lines[i])
            i += 1
        if not block:
            continue
        head = block[0].split("\t")
        code = head[0].strip()
        if not code or " " in code:
            continue
        clean = lambda t: re.sub(r"\s+", " ", t).strip().strip('"').strip()
        parse = clean(head[1]) if len(head) > 1 else ""
        rest = [clean(b) for b in block[1:] if clean(b)]
        short = rest[0] if rest else ""
        meaning = rest[1] if len(rest) > 1 else ""
        example = rest[2] if len(rest) > 2 else ""
        example = re.sub(r"^Example:\s*", "", example)
        yield dict(code=code, lang=lang, parse=parse, short=short, meaning=meaning, example=example)


def ingest(conn: sqlite3.Connection, source: Path, *, force: bool = False) -> dict:
    """Load the data into the library database. Idempotent unless force or the format changed."""
    ensure_schema(conn)
    have = conn.execute("SELECT value FROM meta WHERE key='originals'").fetchone()
    if have and not force:
        info = json.loads(have[0])
        if info.get("format") == FORMAT:
            log.info("original languages already in the library (%s words); use --force to reload", info.get("words"))
            return info
        log.info("original languages were loaded in an older format; reloading")
    conn.execute("DELETE FROM original_words")
    conn.execute("INSERT INTO original_verses(original_verses) VALUES ('delete-all')")
    conn.execute("DELETE FROM original_verse_refs")
    conn.execute("DELETE FROM original_lexicon")
    conn.execute("DELETE FROM original_morph")

    words = 0
    verse_rows: dict[tuple, dict] = {}
    cols = ["book", "chapter", "verse", "seq", "lang", "word", "translit", "gloss", "strongs", "root", "morph", "tags", "flags"]
    sql = f"INSERT INTO original_words({','.join(cols)}) VALUES ({','.join('?' for _ in cols)})"
    batch: list[tuple] = []

    def flush() -> None:
        nonlocal batch
        if batch:
            conn.executemany(sql, batch)
            batch = []

    for group, parser in (("hebrew", parse_hebrew), ("greek", parse_greek)):
        for path in _files(source, group):
            log.info("reading %s", path.name)
            for w in parser(path):
                batch.append(tuple(w[c] for c in cols))
                words += 1
                key = (w["book"], w["chapter"], w["verse"])
                v = verse_rows.setdefault(key, {"plain": [], "translit": [], "strongs": [], "glosses": [], "lang": w["lang"]})
                v["plain"].append(strip_marks(w["word"], w["lang"]))
                v["translit"].append(ascii_translit(w["translit"]))
                for s in (w["strongs"] or "").split():
                    v["strongs"].append(s)
                    base = re.sub(r"[A-Za-z]$", "", s)
                    if base != s:
                        v["strongs"].append(base)
                v["glosses"].append(re.sub(r"[<>\[\]]", "", w["gloss"] or ""))
                if len(batch) >= 5000:
                    flush()
    flush()
    log.info("%d words; writing %d verses", words, len(verse_rows))
    for i, (k, v) in enumerate(verse_rows.items(), start=1):
        conn.execute("INSERT INTO original_verses(rowid, plain, translit, strongs, glosses) VALUES (?,?,?,?,?)",
                     (i, " ".join(v["plain"]), " ".join(t for t in v["translit"] if t), " ".join(dict.fromkeys(v["strongs"])), " ".join(v["glosses"])))
        conn.execute("INSERT INTO original_verse_refs(id, book, chapter, verse, lang) VALUES (?,?,?,?,?)", (i, k[0], k[1], k[2], v["lang"]))
    entries = 0
    for group, lang in (("lexicon_hebrew", "he"), ("lexicon_greek", "gr")):
        for path in _files(source, group):
            log.info("reading %s", path.name)
            rows = list(parse_lexicon(path, lang))
            conn.executemany(
                "INSERT OR REPLACE INTO original_lexicon(strongs, base, lang, lemma, translit, type, gloss, definition, relation) VALUES (?,?,?,?,?,?,?,?,?)",
                [(r["strongs"], r["base"], r["lang"], r["lemma"], r["translit"], r["type"], r["gloss"], r["definition"], r["relation"]) for r in rows],
            )
            # a plain number looks up its first entry
            seen = set()
            for r in rows:
                if r["base"] not in seen and r["base"] != r["strongs"]:
                    seen.add(r["base"])
                    conn.execute(
                        "INSERT OR IGNORE INTO original_lexicon(strongs, base, lang, lemma, translit, type, gloss, definition, relation) VALUES (?,?,?,?,?,?,?,?,?)",
                        (r["base"], r["base"], r["lang"], r["lemma"], r["translit"], r["type"], r["gloss"], r["definition"], r["relation"]),
                    )
            entries += len(rows)
    morphs = 0
    for group, lang in (("morph_hebrew", "he"), ("morph_greek", "gr")):
        for path in _files(source, group):
            log.info("reading %s", path.name)
            rows = list(parse_morph(path, lang))
            conn.executemany("INSERT OR REPLACE INTO original_morph(code, lang, parse, short, meaning, example) VALUES (?,?,?,?,?,?)",
                             [(r["code"], r["lang"], r["parse"], r["short"], r["meaning"], r["example"]) for r in rows])
            morphs += len(rows)
    info = {
        "format": FORMAT, "words": words, "verses": len(verse_rows), "lexicon": entries, "morph": morphs,
        "loaded_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "STEP Bible (Tyndale House, Cambridge), https://STEPBible.github.io/STEPBible-Data", "license": "CC BY 4.0",
    }
    conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('originals', ?)", (json.dumps(info),))
    conn.commit()
    log.info("original languages loaded: %s", info)
    return info
