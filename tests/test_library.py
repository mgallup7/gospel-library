"""Run with:  .venv/bin/python -m pytest -q"""

from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest

from gospel_library import config, scriptures, search, toc
from gospel_library.db import Store
from gospel_library.fetch import decode_state, normalize_uri
from gospel_library.parse import parse_content

FIX = Path(__file__).parent / "fixtures"

TALK_BODY = """<header>
<h1 data-aid="1" id="p_title">Think Celestial!</h1>
<div class="byline"><p class="author-name" data-aid="2" id="p_a">By President Russell M. Nelson</p>
<p class="author-role" data-aid="3" id="p_r">President of The Church of Jesus Christ of Latter-day Saints</p></div>
<p class="kicker" data-aid="4" id="p_k">A kicker sentence.</p></header>
<div class="body-block">
<p data-aid="5" id="p_1">My dear brothers and sisters, the choices you make<a class="study-note-ref" href="/study/general-conference/2023/10/51nelson?lang=eng#note1" data-scroll-id="note1"><sup class="marker">1</sup></a> matter.</p>
<h2 data-aid="6" id="p_h">A Heading</h2>
<p data-aid="7" id="p_2">Think celestial! Faith in Jesus Christ changes everything.</p>
<ul><li data-aid="8" id="p_3">A list item with words.</li></ul>
</div>"""

TALK_PAYLOAD = {
    "meta": {
        "title": "Think Celestial!",
        "pageAttributes": {"data-content-type": "general-conference-talk", "data-uri": "/general-conference/2023/10/51nelson"},
        "structuredData": json.dumps({"datePublished": "2023-10-01T00:00:00.000Z", "mainEntity": {"author": {"name": "Russell M. Nelson"}}}),
    },
    "content": {
        "head": {"page-meta-social": {"pageMeta": {"description": "President Nelson teaches."}}},
        "body": TALK_BODY,
        "footnotes": {"note1": {"marker": "1", "text": "See <a class=\"scripture-ref\" href=\"/study/scriptures/bofm/alma/32?lang=eng&id=p21#p21\">Alma 32:21</a>.",
                                 "referenceUris": [{"type": "scripture-ref", "href": "/study/scriptures/bofm/alma/32?lang=eng&id=p21#p21"}]}},
    },
}

CHAPTER_BODY = """<header><h1 id="title1">The Book of Alma</h1><p class="subtitle" id="subtitle1">The Son of Alma</p>
<p class="title-number" id="title_number1">Chapter 32</p>
<p class="study-summary" id="study_summary1">Alma teaches the poor whose afflictions had humbled them.</p></header>
<div class="body-block">
<p class="verse" id="p1"><span class="verse-number">1 </span>And it came to pass that they did go forth.</p>
<p class="verse" id="p21"><span class="verse-number">21 </span>And now as I said concerning <a class="study-note-ref" href="#note21a" data-scroll-id="note21a"><sup class="marker">a</sup>faith</a>—faith is not to have a perfect knowledge of things.</p>
</div>"""

CHAPTER_PAYLOAD = {
    "meta": {"title": "Alma 32", "pageAttributes": {"data-content-type": "chapter"}},
    "content": {"body": CHAPTER_BODY, "footnotes": {"note21a": {"marker": "a", "text": "TG Faith.", "referenceUris": []}}},
}


def _state_html(state: dict) -> str:
    b64 = base64.b64encode(json.dumps(state).encode()).decode()
    return f'<html><body><script>window.__INITIAL_STATE__="{b64}";</script></body></html>'


BOOK_STATE = {
    "reader": {
        "bookStore": {
            "/eng/general-conference/2023/10": {
                "title": "October 2023 general conference",
                "uri": "/study/general-conference/2023/10",
                "contentType": "general-conference",
                "entries": [
                    {"content": {"uri": "/study/general-conference/2023/10", "title": "Contents"}},
                    {"section": {"title": "Sunday Afternoon Session", "uri": "/study/general-conference/2023/10/sunday-afternoon-session",
                                 "entries": [
                                     {"content": {"uri": "/study/general-conference/2023/10/51nelson", "title": "Think Celestial!", "subtitle": "Russell M. Nelson"}},
                                     {"content": {"uri": "/study/general-conference/2023/10/57oaks", "title": "Kingdoms of Glory", "subtitle": "Dallin H. Oaks"}},
                                 ]}},
                ],
            }
        },
        "contentStore": {},
    }
}


# --------------------------------------------------------------- parsing --

def test_parse_talk():
    d = parse_content(TALK_PAYLOAD, "/general-conference/2023/10/51nelson")
    assert d.title == "Think Celestial!"
    assert d.author == "President Russell M. Nelson"
    assert d.author_role.startswith("President of")
    assert d.kicker == "A kicker sentence."
    assert d.date == "2023-10-01"
    assert d.content_type == "general-conference-talk"
    kinds = [p.kind for p in d.paragraphs]
    assert kinds == ["title", "byline", "byline", "kicker", "para", "heading", "para", "para"]
    body = [p for p in d.paragraphs if p.kind == "para"]
    assert body[0].text == "My dear brothers and sisters, the choices you make matter."  # marker removed
    assert body[-1].text == "A list item with words."
    assert d.footnotes[0].pid == "p_1" and d.footnotes[0].text == "See Alma 32:21."
    assert d.footnotes[0].refs[0]["type"] == "scripture-ref"
    assert d.description == "President Nelson teaches."
    assert "<sup" in d.body_html  # reader keeps the markup


def test_parse_chapter_verses():
    d = parse_content(CHAPTER_PAYLOAD, "/scriptures/bofm/alma/32")
    verses = [p for p in d.paragraphs if p.kind == "verse"]
    assert [v.verse for v in verses] == [1, 21]
    assert verses[1].text.startswith("And now as I said concerning faith—faith is not")
    assert d.subtitle == "The Son of Alma"
    summary = [p for p in d.paragraphs if p.kind == "summary"][0]
    assert summary.text.startswith("Alma teaches the poor")
    assert d.footnotes[0].pid == "p21"


def test_parse_content_hash_is_stable():
    a = parse_content(TALK_PAYLOAD, "/x")
    b = parse_content(json.loads(json.dumps(TALK_PAYLOAD)), "/x")
    assert a.content_hash == b.content_hash


# ------------------------------------------------------------------- toc --

def test_toc_from_state_and_manifest_agree():
    state = decode_state(_state_html(BOOK_STATE))
    t = toc.from_state(state, "/general-conference/2023/10")
    assert t.title == "October 2023 general conference"
    assert [n.kind for n in t.nodes] == ["section", "content", "content"]
    assert t.content_nodes[0].subtitle == "Russell M. Nelson"
    assert t.content_nodes[0].section_path == ["Sunday Afternoon Session"]

    manifest = """<header><h1 class="title">October 2023 general conference</h1></header>
    <nav class="manifest"><ul class="doc-map"><li><h2 class="label"><p class="title">Sunday Afternoon Session</p></h2>
    <ul class="doc-map"><li><a href="/study/general-conference/2023/10/sunday-afternoon-session?lang=eng" class="list-tile"><p class="title">Sunday Afternoon Session</p></a></li>
    <li><a href="/study/general-conference/2023/10/51nelson?lang=eng" class="list-tile"><p class="primaryMeta">Russell M. Nelson</p><p class="title">Think Celestial!</p></a></li>
    <li><a href="/study/general-conference/2023/10/57oaks?lang=eng" class="list-tile"><p class="primaryMeta">Dallin H. Oaks</p><p class="title">Kingdoms of Glory</p></a></li>
    </ul></li></ul></nav>"""
    m = toc.from_manifest(manifest, "/general-conference/2023/10")
    assert [(n.kind, n.uri, n.title, n.subtitle) for n in m.nodes] == [(n.kind, n.uri, n.title, n.subtitle) for n in t.nodes]


def test_normalize_uri():
    assert normalize_uri("/study/scriptures/bofm/alma/32?lang=eng#p21") == "/scriptures/bofm/alma/32"
    assert normalize_uri("/eng/general-conference/2026/04") == "/general-conference/2026/04"
    assert normalize_uri("https://www.churchofjesuschrist.org/study/manual/general-handbook?lang=eng") == "/manual/general-handbook"


# ------------------------------------------------------------ references --

@pytest.mark.parametrize("text,label,uri,pid", [
    ("Alma 32:21", "Alma 32:21", "/scriptures/bofm/alma/32", "p21"),
    ("alma 32 21", "Alma 32:21", "/scriptures/bofm/alma/32", "p21"),
    ("D&C 76:22-24", "D&C 76:22–24", "/scriptures/dc-testament/dc/76", "p22"),
    ("dc 76", "D&C 76", "/scriptures/dc-testament/dc/76", None),
    ("1 ne 3:7", "1 Nephi 3:7", "/scriptures/bofm/1-ne/3", "p7"),
    ("js-h 1:17", "Joseph Smith—History 1:17", "/scriptures/pgp/js-h/1", "p17"),
    ("Moses 1:39", "Moses 1:39", "/scriptures/pgp/moses/1", "p39"),
    ("psalm 23", "Psalm 23", "/scriptures/ot/ps/23", None),
    ("Matt. 5:48", "Matthew 5:48", "/scriptures/nt/matt/5", "p48"),
    ("enos 3", "Enos 1:3", "/scriptures/bofm/enos/1", "p3"),
    ("a of f 1:13", "Articles of Faith 1:13", "/scriptures/pgp/a-of-f/1", "p13"),
    ("jst matt 5", "JST, Matthew 5", "/scriptures/jst/jst-matt/5", None),
])
def test_parse_reference(text, label, uri, pid):
    ref = scriptures.parse_reference(text)
    assert ref is not None, text
    assert ref.label == label
    assert ref.uri == uri
    assert ref.pid == pid


@pytest.mark.parametrize("text", ["faith", "plan of happiness", "alma 999", "think celestial", "2020 conference", "covenant path"])
def test_not_a_reference(text):
    assert scriptures.parse_reference(text) is None


def test_book_for_uri():
    b, chapter = scriptures.book_for_uri("/scriptures/bofm/alma/32")
    assert b.slug == "alma" and chapter == "32"
    assert scriptures.book_for_uri("/general-conference/2023/10/51nelson") is None
    assert scriptures.sort_key("/scriptures/bofm/1-ne/1") < scriptures.sort_key("/scriptures/bofm/alma/32") < scriptures.sort_key("/scriptures/dc-testament/dc/1")


# ---------------------------------------------------------------- search --

def test_compile_query():
    q = search.compile_query('"plan of happiness" faith -works speaker:nelson year:2015-2020 book:alma in:conference')
    assert q.match == '("plan of happiness" "faith") NOT "works"'
    assert q.speaker == "nelson" and q.year_from == 2015 and q.year_to == 2020
    assert q.book_slug == "alma" and q.collections == ["general-conference"]
    assert search.compile_query("covenant-path").match == '"covenant path"'
    assert search.compile_query("hope OR charity").match == '"hope" OR "charity"'
    assert search.compile_query("bapt", typeahead=True).match == '"bapt"*'
    assert search.compile_query("bapt ", typeahead=True).match == '"bapt"'
    assert search.compile_query("Lord's").match == '"Lord s"'
    assert search.compile_query("   ").match is None


def test_store_and_search(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "lib.sqlite")
    store = Store(config.DB_PATH)
    cid = store.collection_id("general-conference", "General Conference", "conference", 1)
    bid = store.book_id(cid, "/general-conference/2023/10", "October 2023 general conference", year=2023, month=10)
    from gospel_library.sync import context_for
    state = decode_state(_state_html(BOOK_STATE))
    node = toc.from_state(state, "/general-conference/2023/10").content_nodes[0]
    doc = parse_content(TALK_PAYLOAD, node.uri)
    _, outcome = store.save_document(collection_id=cid, book_id=bid, doc=doc, node=node, extra=context_for(node.uri, node=node))
    assert outcome == "added"
    _, outcome = store.save_document(collection_id=cid, book_id=bid, doc=doc, node=node, extra=context_for(node.uri, node=node))
    assert outcome == "unchanged"

    scid = store.collection_id("scriptures", "Scriptures", "books", 0)
    sbid = store.book_id(scid, "/scriptures/bofm", "Book of Mormon")
    cdoc = parse_content(CHAPTER_PAYLOAD, "/scriptures/bofm/alma/32")
    store.save_document(collection_id=scid, book_id=sbid, doc=cdoc, node=None, extra=context_for(cdoc.uri, node=None))

    conn = store.conn
    res = search.search(conn, "faith")
    cites = [h["citation"] for h in res["hits"]]
    assert "Alma 32:21" in cites
    assert any("Think Celestial" in c for c in cites)
    assert res["hits"][0]["snippet"].count("<mark>") >= 1

    res = search.search(conn, "faith", scope="conference")
    assert all(h["collection"] == "general-conference" for h in res["hits"])
    assert res["hits"][0]["session"] == "Sunday Afternoon Session"
    assert res["hits"][0]["label"] == "October 2023 General Conference"

    res = search.search(conn, "alma 32:21")
    assert res["jump"]["doc_id"] is not None and res["jump"]["pid"] == "p21"

    res = search.search(conn, "celestial", group="documents")
    assert res["documents"][0]["title"] == "Think Celestial!"

    d = search.document(conn, uri="/general-conference/2023/10/51nelson")
    assert d["author"] == "Russell M. Nelson" and d["author_role"].startswith("President of")
    assert d["footnotes"][0]["marker"] == "1"
    assert search.resolve(conn, "/study/scriptures/bofm/alma/32?lang=eng&id=p21#p21")["pid"] == "p21"
    assert search.speakers(conn)[0]["name"] == "Russell M. Nelson"
    store.close()


def test_bundle_round_trip(tmp_path, monkeypatch):
    from gospel_library import bundle

    monkeypatch.setattr(config, "DB_PATH", tmp_path / "lib.sqlite")
    store = Store(config.DB_PATH)
    cid = store.collection_id("scriptures", "Scriptures", "books", 0)
    bid = store.book_id(cid, "/scriptures/bofm", "Book of Mormon")
    doc = parse_content(CHAPTER_PAYLOAD, "/scriptures/bofm/alma/32")
    from gospel_library.sync import context_for
    store.save_document(collection_id=cid, book_id=bid, doc=doc, node=None, extra=context_for(doc.uri, node=None))
    store.optimize()
    store.close()

    out = tmp_path / "site"
    skills = tmp_path / "skills.json"
    skills.write_text('{"voice": "warm", "skills": [{"id": "weekly-letter", "name": "Letter", "kind": "mode", "text": "Write the letter."}]}', encoding="utf-8")
    manifest = bundle.build(out, "a long passphrase", db_path=config.DB_PATH, skills_path=skills)
    assert (out / "library.bin").exists() and manifest["documents"] == 1 and manifest["verses"] == 2
    assert manifest["skills"]["file"] == "skills.bin" and (out / "skills.bin").exists()
    back = tmp_path / "skills-back.json"
    bundle.decrypt_file(out / "skills.bin", back, "a long passphrase")
    assert back.read_text(encoding="utf-8") == skills.read_text(encoding="utf-8")
    nos = bundle.build(tmp_path / "site2", "a long passphrase", db_path=config.DB_PATH, skills_path=tmp_path / "none.json")
    assert "skills" not in nos
    header = bundle.read_header(out / "library.bin")
    assert header["version"] == manifest["version"] and header["chunks"] >= 1

    plain = tmp_path / "back.sqlite"
    bundle.decrypt_file(out / "library.bin", plain, "a long passphrase")
    import sqlite3
    conn = sqlite3.connect(plain)
    assert conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0] == 1
    assert conn.execute("SELECT rowid FROM paragraphs WHERE paragraphs MATCH 'faith'").fetchall()
    with pytest.raises(ValueError):
        bundle.decrypt_file(out / "library.bin", tmp_path / "x.sqlite", "wrong")


def test_book_moves_between_collections(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "lib.sqlite")
    store = Store(config.DB_PATH)
    manuals = store.collection_id("manuals", "Manuals", "books", 5)
    bid = store.book_id(manuals, "/manual/preach-my-gospel-2023", "Preach My Gospel")
    doc = parse_content(TALK_PAYLOAD, "/manual/preach-my-gospel-2023/1-purpose")
    store.save_document(collection_id=manuals, book_id=bid, doc=doc, node=None, extra={})
    pmg = store.collection_id("preach-my-gospel", "Preach My Gospel", "books", 4)
    bid2 = store.book_id(pmg, "/manual/preach-my-gospel-2023", "Preach My Gospel")
    assert bid2 == bid
    row = store.conn.execute("SELECT collection_id FROM documents WHERE uri=?", ("/manual/preach-my-gospel-2023/1-purpose",)).fetchone()
    assert row[0] == pmg
    assert "/manual/preach-my-gospel-2023/1-purpose" in store.known_uris(pmg)
    store.close()


def test_sync_moves_cached_book_to_new_collection(tmp_path, monkeypatch):
    """A book whose TOC is not due for a re-read still moves shelves."""
    from gospel_library.sync import Syncer
    from gospel_library.toc import Node

    monkeypatch.setattr(config, "DB_PATH", tmp_path / "lib.sqlite")
    store = Store(config.DB_PATH)
    manuals = store.collection_id("manuals", "Manuals", "books", 5)
    bid = store.book_id(manuals, "/manual/preach-my-gospel-2023", "Preach My Gospel")
    node = Node(kind="content", uri="/manual/preach-my-gospel-2023/1-purpose", title="Purpose", order=1)
    store.record_toc(bid, [node], next_check_days=30)
    doc = parse_content(TALK_PAYLOAD, node.uri)
    store.save_document(collection_id=manuals, book_id=bid, doc=doc, node=node, extra={})

    class NoNetwork:
        requests_made = 0
        cache = None
        def page_state(self, *a, **k): raise AssertionError("should not fetch")
        def content(self, *a, **k): raise AssertionError("should not fetch")

    pmg = store.collection_id("preach-my-gospel", "Preach My Gospel", "books", 4)
    syncer = Syncer(store, NoNetwork())
    nodes, book_id = syncer._book_nodes(pmg, "/manual/preach-my-gospel-2023", sort=0, toc_days=30, missing_days=7)
    assert book_id == bid and [n.uri for n in nodes] == [node.uri]
    assert store.conn.execute("SELECT collection_id FROM books WHERE id=?", (bid,)).fetchone()[0] == pmg
    assert store.conn.execute("SELECT collection_id FROM documents WHERE uri=?", (node.uri,)).fetchone()[0] == pmg
    store.close()
