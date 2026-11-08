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



def _edited(payload, *changes):
    """A copy of a fixture payload with the given text replaced, as if the site had changed the page."""
    text = json.dumps(payload)
    for old, new in changes:
        assert old in text, old
        text = text.replace(old, new)
    return json.loads(text)

def test_delta_between_builds(tmp_path, monkeypatch):
    """A device at build 1 gets build 2 from a small delta that reproduces the library exactly."""
    import sqlite3
    from gospel_library import bundle, delta
    from gospel_library.sync import context_for

    monkeypatch.setattr(config, "DB_PATH", tmp_path / "lib.sqlite")
    store = Store(config.DB_PATH)
    cid = store.collection_id("scriptures", "Scriptures", "books", 0)
    bid = store.book_id(cid, "/scriptures/bofm", "Book of Mormon")
    alma = parse_content(CHAPTER_PAYLOAD, "/scriptures/bofm/alma/32")
    store.save_document(collection_id=cid, book_id=bid, doc=alma, node=None, extra=context_for(alma.uri, node=None))
    for n in range(34, 40):  # chapters that will not change: a delta is only worth shipping when most of the library stays
        same = parse_content(_edited(CHAPTER_PAYLOAD, ("Alma 32", f"Alma {n}")), f"/scriptures/bofm/alma/{n}")
        store.save_document(collection_id=cid, book_id=bid, doc=same, node=None, extra=context_for(same.uri, node=None))
    gcid = store.collection_id("general-conference", "General Conference", "conference", 1)
    gbid = store.book_id(gcid, "/general-conference/2023/10", "October 2023 general conference", year=2023, month=10)
    state = decode_state(_state_html(BOOK_STATE))
    node = toc.from_state(state, "/general-conference/2023/10").content_nodes[0]
    talk = parse_content(TALK_PAYLOAD, node.uri)
    store.save_document(collection_id=gcid, book_id=gbid, doc=talk, node=node, extra=context_for(node.uri, node=node))
    store.optimize()
    store.close()

    # build 1: the device's library
    site1 = tmp_path / "site1"
    m1 = bundle.build(site1, "pw", db_path=config.DB_PATH, skills_path=tmp_path / "none.json")
    assert "deltas" not in m1
    device = tmp_path / "device.sqlite"
    bundle.decrypt_file(site1 / "library.bin", device, "pw")

    # the library changes: the talk is re-fetched with new text, a chapter is added, the counts move on
    store = Store(config.DB_PATH)
    changed = parse_content(_edited(TALK_PAYLOAD, ("celestial", "celestial and eternal")), node.uri)
    _, outcome = store.save_document(collection_id=gcid, book_id=gbid, doc=changed, node=node, extra=context_for(node.uri, node=node))
    assert outcome == "changed"
    second = parse_content(_edited(CHAPTER_PAYLOAD, ("Alma 32", "Alma 33")), "/scriptures/bofm/alma/33")
    store.save_document(collection_id=cid, book_id=bid, doc=second, node=None, extra=context_for(second.uri, node=None))
    store.optimize()
    store.close()

    # build 2 ships a delta from build 1
    site2 = tmp_path / "site2"
    m2 = bundle.build(site2, "pw", db_path=config.DB_PATH, skills_path=tmp_path / "none.json")
    assert m2["version"] != m1["version"]
    assert m2["deltas"] and m2["deltas"][0]["from"] == m1["version"]
    d = m2["deltas"][0]
    assert d["documents_changed"] == 2 and d["documents_removed"] == 0
    assert (site2 / d["file"]).stat().st_size < (site2 / "library.bin").stat().st_size
    # the snapshots stay with the job, not the device
    conn = sqlite3.connect(config.DB_PATH)
    assert conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0] == 2
    conn.close()
    full = tmp_path / "full2.sqlite"
    bundle.decrypt_file(site2 / "library.bin", full, "pw")
    assert not sqlite3.connect(full).execute("SELECT 1 FROM sqlite_master WHERE name='snapshots'").fetchone()

    # applied to the device, the delta reproduces build 2 exactly
    plain = tmp_path / "delta.sqlite"
    bundle.decrypt_file(site2 / d["file"], plain, "pw")
    dev = sqlite3.connect(device)
    info = delta.apply_delta(dev, plain)
    assert info["to"] == m2["version"]
    assert delta.library_version(dev) == m2["version"]
    assert dev.execute("SELECT COUNT(*) FROM documents").fetchone()[0] == 9
    assert dev.execute("SELECT rowid FROM paragraphs WHERE paragraphs MATCH 'eternal'").fetchall()
    assert dev.execute("SELECT title FROM documents_fts WHERE documents_fts MATCH 'Alma'").fetchall()
    assert json.loads(dev.execute("SELECT value FROM meta WHERE key='counts'").fetchone()[0])["paragraphs"] == dev.execute("SELECT COUNT(*) FROM paragraphs").fetchone()[0]
    dev.close()
    # a delta applied to the wrong library is refused and leaves it untouched
    other = sqlite3.connect(full)
    before = other.execute("SELECT COUNT(*) FROM paragraphs").fetchone()[0]
    with pytest.raises(ValueError):
        delta.apply_delta(other, plain)
    assert other.execute("SELECT COUNT(*) FROM paragraphs").fetchone()[0] == before
    other.close()

    # meaning vectors arrive between builds: the delta carries exactly the ones embedded since
    from gospel_library import embed
    e = embed.Embedder(_stub_model(tmp_path / "model"), threads=1)
    conn = sqlite3.connect(config.DB_PATH)
    embed.embed_missing(conn, e)
    n_vectors = conn.execute("SELECT COUNT(*) FROM vectors").fetchone()[0]
    conn.close()
    assert n_vectors > 5
    site3 = tmp_path / "site3"
    m3 = bundle.build(site3, "pw", db_path=config.DB_PATH, skills_path=tmp_path / "none.json")
    assert m3["version"] != m2["version"]  # the text did not change, but what the device holds did
    d3 = next(d for d in m3["deltas"] if d["from"] == m2["version"])
    bundle.decrypt_file(site3 / d3["file"], plain, "pw")
    dev = sqlite3.connect(device)
    assert delta.apply_delta(dev, plain)["vecbits"] == n_vectors
    assert dev.execute("SELECT COUNT(*) FROM vecbits").fetchone()[0] == n_vectors
    dev.close()
    # one chapter changes and is embedded again: the next delta ships that chapter's vectors, not all of them
    store = Store(config.DB_PATH)
    again = parse_content(_edited(CHAPTER_PAYLOAD, ("Alma 32", "Alma 39"), ("perfect knowledge", "perfect knowledge of all")), "/scriptures/bofm/alma/39")
    _, outcome = store.save_document(collection_id=cid, book_id=bid, doc=again, node=None, extra=context_for(again.uri, node=None))
    assert outcome == "changed"
    store.close()
    conn = sqlite3.connect(config.DB_PATH)
    assert embed.embed_missing(conn, e)["count"] == n_vectors  # the chapter's vectors are back, nothing else moved
    in_chapter = conn.execute("SELECT COUNT(*) FROM vectors v JOIN paragraphs p ON p.rowid = v.paragraph_id WHERE p.document_id = (SELECT id FROM documents WHERE uri='/scriptures/bofm/alma/39')").fetchone()[0]
    conn.close()
    assert 0 < in_chapter < n_vectors
    site4 = tmp_path / "site4"
    m4 = bundle.build(site4, "pw", db_path=config.DB_PATH, skills_path=tmp_path / "none.json")
    d4 = next(d for d in m4["deltas"] if d["from"] == m3["version"])
    bundle.decrypt_file(site4 / d4["file"], plain, "pw")
    dd = sqlite3.connect(plain)
    assert dd.execute("SELECT COUNT(*) FROM vecbits").fetchone()[0] == in_chapter and dd.execute("SELECT COUNT(*) FROM documents").fetchone()[0] == 1
    dd.close()
    dev = sqlite3.connect(device)
    assert delta.apply_delta(dev, plain)["to"] == m4["version"] and dev.execute("SELECT COUNT(*) FROM vecbits").fetchone()[0] == n_vectors
    dev.close()


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


def test_originals_ingest(tmp_path):
    """The Hebrew and Greek word tables: references, order, searching, lexicon."""
    import sqlite3

    from gospel_library import originals as O

    src = Path(__file__).parent / "fixtures" / "originals"
    conn = sqlite3.connect(tmp_path / "o.sqlite")
    conn.execute("CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT)")
    info = O.ingest(conn, src)
    assert info["words"] > 40 and info["verses"] >= 6 and info["lexicon"] >= 3
    gen = conn.execute("SELECT seq, word, translit, gloss, strongs, root, morph FROM original_words WHERE book='genesis' AND chapter=1 AND verse=1 ORDER BY seq").fetchall()
    assert [O.strip_marks(g[1], "he") for g in gen][:3] == ["בראשית", "ברא", "אלהים"] and gen[0][4] == "H7225G" and gen[0][6] == "HR/Ncfsa"
    # Psalm 51's two-verse Hebrew title is one KJV title, in order
    title = conn.execute("SELECT gloss FROM original_words WHERE book='psalms' AND chapter=51 AND verse=0 ORDER BY seq").fetchall()
    assert title[0][0].startswith("to the choirmaster") and title[-1][0] == "-sheba"
    # NRSV Matthew 17:15 is part of the KJV's 17:14, after 17:14's own words
    m = conn.execute("SELECT seq, word FROM original_words WHERE book='matthew' AND chapter=17 AND verse=14 ORDER BY seq").fetchall()
    assert m[0][1] == "Καὶ" and m[-1][0] > 15000 and not conn.execute("SELECT 1 FROM original_words WHERE book='matthew' AND chapter=17 AND verse=15").fetchone()
    # the Johannine Comma is marked as the KJV's Greek only
    k = conn.execute("SELECT flags, tags FROM original_words WHERE book='1-john' AND chapter=5 AND verse=7 AND word='ἕν'").fetchone()
    assert k == ("K", "TR")
    # searching: Hebrew letters without points, Greek without accents, a Strong's number, a transliteration
    find = lambda m: conn.execute("SELECT r.book, r.chapter, r.verse FROM original_verses v JOIN original_verse_refs r ON r.id=v.rowid WHERE original_verses MATCH ?", (m,)).fetchall()
    assert ("genesis", 1, 1) in find("plain:בראשית") and ("genesis", 1, 1) in find("translit:bereshit")
    assert ("matthew", 1, 1) in find("plain:βιβλος") and ("matthew", 1, 1) in find("strongs:G0976") and ("genesis", 1, 1) in find("strongs:H7225")
    lex = conn.execute("SELECT lemma, translit, gloss FROM original_lexicon WHERE strongs='H7225G'").fetchone()
    assert O.strip_marks(lex[0], "he") == "ראשית" and lex[2].endswith("beginning")
    assert O.strip_marks(conn.execute("SELECT lemma FROM original_lexicon WHERE strongs='G0026'").fetchone()[0], "gr") == "αγαπη"
    # grammar codes come with their meaning in words
    m = conn.execute("SELECT short, meaning FROM original_morph WHERE code='HVqp3ms'").fetchone()
    assert m[0].startswith("Verb : Qal") and "ACTION" in m[1]
    assert conn.execute("SELECT short FROM original_morph WHERE code='V-IAI-3S'").fetchone()[0].startswith("Verb Imperfect Active")
    # transliterations are searchable as typed: no macrons ("ēn" -> "en"), no dots
    assert ("matthew", 1, 1) in find("translit:iesou") and ("genesis", 1, 1) in find("translit:elohim")
    # the lexicon carries the typed form and how common each word is (the app's "In the Greek: agapē" hint looks these up)
    assert conn.execute("SELECT ascii FROM original_lexicon WHERE strongs='G0026'").fetchone()[0] == "agape"
    assert conn.execute("SELECT occurrences FROM original_lexicon WHERE strongs='G0976'").fetchone()[0] >= 1
    assert conn.execute("SELECT occurrences FROM original_lexicon WHERE strongs='H7225'").fetchone()[0] >= 1
    # idempotent, and reloaded when the format changes
    assert O.ingest(conn, src)["words"] == info["words"] and info["format"] == O.FORMAT and info["morph"] >= 6
    conn.execute("UPDATE meta SET value=json_set(value, '$.format', 1) WHERE key='originals'")
    assert O.ingest(conn, src)["format"] == O.FORMAT


def test_joseph_smith_papers(tmp_path):
    """The Papers: the site's page data cleaned into documents, and the sync's bookkeeping."""
    import json

    from gospel_library import jsp
    from gospel_library.db import Store

    fx = Path(__file__).parent / "fixtures" / "jsp"
    load = lambda name: json.loads((fx / name).read_text(encoding="utf-8"))

    # a journal page: entries become headings, notes become footnotes, names open their bios
    pp = load("journal-26.json")
    s = dict(pp["summary"]); s["_toc"] = pp["tableOfContents"]; s["_gallery"] = pp["gallery"]
    docs = jsp.paper_documents([s], "journal-december-1841-december-1842", "Journal, December 1841–December 1842", whole=False)
    page = docs[0]
    assert page.uri == "/paper-summary/journal-december-1841-december-1842/26" and page.title.endswith(", page 95") and page.content_type == "jsp-page"
    assert page.paragraphs[0].kind == "heading" and page.paragraphs[0].text == "6 May 1842 • Friday"
    assert page.paragraphs[1].kind == "para" and page.paragraphs[1].text.startswith("Friday 6 Attended the officer drill") and "179" not in page.paragraphs[1].text
    assert '<a class="study-note-ref" href="#n179"><sup class="marker">179</sup></a>' in page.body_html
    assert '<a class="study-note-ref jsp-ref" href="#per294">Lyman Wight</a>' in page.body_html and "popup" not in page.body_html
    notes = {f.note_id: f for f in page.footnotes}
    assert notes["n179"].marker == "179" and notes["n179"].pid == "p2" and "officer drill" in notes["n179"].text
    assert notes["per294"].marker == "" and notes["per294"].html.startswith("<p><b>Lyman Wight</b></p>") and "josephsmithpapers.org" in notes["per294"].html
    assert "<s>two</s>" in page.body_html  # a deletion in the manuscript
    assert [d.content_type for d in docs] == ["jsp-page", "jsp-source-note", "jsp-introduction"]
    assert docs[1].title.startswith("Source Note: Journal") and docs[2].paragraphs

    # a short letter: one document for the whole paper, page breaks marked
    p1, p2 = load("letter-1.json"), load("letter-2.json")
    s1 = dict(p1["summary"]); s1["_toc"] = []; s1["_gallery"] = p1["gallery"]
    s2 = dict(p2["summary"]); s2["_toc"] = []; s2["_gallery"] = p2["gallery"]
    docs = jsp.paper_documents([s1, s2], "letter-to-emma-smith-4-june-1834", "Letter to Emma Smith, 4 June 1834", whole=True)
    letter = docs[0]
    assert letter.uri == "/paper-summary/letter-to-emma-smith-4-june-1834" and letter.content_type == "jsp-paper"
    assert letter.body_html.count('class="jsp-page"') == 2 and 'class="jsp right"' in letter.body_html
    assert [p.pid for p in letter.paragraphs] == [f"p{i}" for i in range(1, len(letter.paragraphs) + 1)]
    assert any(f.note_id == "n1" and f.pid for f in letter.footnotes)
    assert letter.paragraphs[0].text.startswith("On the banks of the Mississippi")

    # the sync, with the site played by the fixtures
    class Fake(jsp.JspFetcher):
        def __init__(self):
            super().__init__(interval=0)
            self.paths = []
        def page_props(self, path):
            self.paths.append(path)
            if path == "/the-papers/journals":
                return load("series-journals.json")
            if path == "/the-papers/journals/jsppj1":
                return load("volume-jsppj1.json")
            if path == "/the-papers/journals/jsppj2":
                return {"docDetails": {"panes": [{"sections": [{"links": [{"text": "Letter to Emma Smith, 4 June 1834", "href": "/paper-summary/letter-to-emma-smith-4-june-1834"}]}]}]}}
            if path.startswith("/paper-summary/journal-"):
                d = load("journal-26.json"); d["summary"]["numberOfPages"] = "1"; d["summary"]["requestedPageNumber"] = "1"; return d
            if path == "/paper-summary/letter-to-emma-smith-4-june-1834/1":
                d = load("letter-1.json"); d["summary"]["numberOfPages"] = "2"; return d
            if path == "/paper-summary/letter-to-emma-smith-4-june-1834/2":
                d = load("letter-2.json"); d["summary"]["numberOfPages"] = "2"; return d
            raise jsp.JspError(f"404 {path}")

    store = Store(tmp_path / "jsp.sqlite")
    fake = Fake()
    counts = jsp.JspSync(store, fake, minutes=5).run(["journals"])
    assert counts["papers"] == 3 and counts["errors"] == 0 and counts["documents"] >= 7
    coll = store.conn.execute("SELECT slug, title, kind FROM collections").fetchall()
    assert [tuple(c) for c in coll] == [("jsp-journals", "Joseph Smith Papers: Journals", "jsp")]
    books = store.conn.execute("SELECT uri, title, entry_count FROM books ORDER BY sort").fetchall()
    assert [b["uri"] for b in books] == ["/the-papers/journals/jsppj1", "/the-papers/journals/jsppj2"] and books[0]["title"].startswith("Journals, 1832")
    rows = store.conn.execute("SELECT uri, title, section_path, year FROM documents ORDER BY sort_key").fetchall()
    uris = [r["uri"] for r in rows]
    assert "/paper-summary/letter-to-emma-smith-4-june-1834" in uris and "/paper-summary/journal-1832-1834" in uris
    letter_row = next(r for r in rows if r["uri"] == "/paper-summary/letter-to-emma-smith-4-june-1834")
    assert json.loads(letter_row["section_path"]) == ["Joseph Smith Papers: Journals", "Journals, 1841–1844"] or letter_row["section_path"]
    assert letter_row["year"] == 1834
    # the whole letter's text is searchable, and the nightly recheck leaves the Papers alone
    hit = store.conn.execute("SELECT text FROM paragraphs WHERE paragraphs MATCH 'mumps'").fetchone()
    assert hit and "Mumps" in hit[0]
    assert store.due_documents(10) == []
    # a second run fetches nothing new
    before = fake.requests_made
    jsp.JspSync(store, fake, minutes=5).run(["journals"])
    assert fake.requests_made == before
    assert set(store.get_meta("jsp_papers")) >= {"journal-1832-1834", "letter-to-emma-smith-4-june-1834"}
    store.close()


def _stub_model(dest: Path) -> Path:
    """A tiny model with the real one's inputs and outputs, for the plumbing."""
    import numpy as np
    import onnx
    from onnx import TensorProto, helper, numpy_helper
    from tokenizers import BertWordPieceTokenizer

    dest.mkdir(parents=True, exist_ok=True)
    vocab = ["[PAD]", "[unused0]"] + [f"[unused{i}]" for i in range(1, 99)] + ["[UNK]", "[CLS]", "[SEP]", "[MASK]"]
    words = "the of and to in a is that it faith hope charity god lord jesus christ perfect knowledge things not have ##s ##ed ##ing , . ; : ! ?".split()
    vocab += words
    (dest / "vocab.txt").write_text("\n".join(vocab) + "\n", encoding="utf-8")
    BertWordPieceTokenizer(str(dest / "vocab.txt"), lowercase=True).save(str(dest / "tokenizer.json"))
    rng = np.random.default_rng(1)
    freq = (rng.random((1, 1, 384)) * 0.4 + 0.01).astype(np.float32)
    nodes = [
        helper.make_node("Cast", ["input_ids"], ["idf"], to=TensorProto.FLOAT),
        helper.make_node("Unsqueeze", ["idf", "axes"], ["id3"]),
        helper.make_node("Mul", ["id3", "freq"], ["m"]),
        helper.make_node("Sin", ["m"], ["s"]),
        helper.make_node("Cast", ["attention_mask"], ["mf"], to=TensorProto.FLOAT),
        helper.make_node("Unsqueeze", ["mf", "axes"], ["mf3"]),
        helper.make_node("Mul", ["s", "mf3"], ["sm"]),
        helper.make_node("ReduceMean", ["sm"], ["mean"], axes=[1], keepdims=1),
        helper.make_node("Add", ["sm", "mean"], ["last_hidden_state"]),
    ]
    graph = helper.make_graph(nodes, "stub", [
        helper.make_tensor_value_info("input_ids", TensorProto.INT64, ["b", "s"]),
        helper.make_tensor_value_info("attention_mask", TensorProto.INT64, ["b", "s"]),
        helper.make_tensor_value_info("token_type_ids", TensorProto.INT64, ["b", "s"]),
    ], [helper.make_tensor_value_info("last_hidden_state", TensorProto.FLOAT, ["b", "s", 384])],
        initializer=[numpy_helper.from_array(freq, "freq"), numpy_helper.from_array(np.array([2], dtype=np.int64), "axes")])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
    model.ir_version = 8
    onnx.save(model, str(dest / "model_quantized.onnx"))
    return dest


def test_embeddings(tmp_path):
    """Vectors for every paragraph, packed as bits for the bundle; stale rows dropped."""
    import sqlite3

    import numpy as np

    from gospel_library import embed

    model = _stub_model(tmp_path / "model")
    e = embed.Embedder(model, threads=1)
    v = e.encode(["Now faith is the substance of things hoped for", "the lord is my shepherd"])
    assert v.shape == (2, 384) and abs(float(np.linalg.norm(v[0])) - 1) < 1e-5
    q = e.encode(["faith is the substance"], query=True)[0]
    assert abs(float(np.linalg.norm(q)) - 1) < 1e-5
    # a small library
    conn = sqlite3.connect(tmp_path / "lib.sqlite")
    conn.executescript("""
      CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE documents(id INTEGER PRIMARY KEY, title TEXT);
      CREATE VIRTUAL TABLE paragraphs USING fts5(text, document_id UNINDEXED, seq UNINDEXED, pid UNINDEXED, kind UNINDEXED, verse UNINDEXED, tokenize='porter unicode61');
      INSERT INTO documents VALUES (1, 'Alma 32'), (2, 'Hebrews 11');
      INSERT INTO paragraphs(rowid, text, document_id, seq, pid, kind, verse) VALUES
        (10, 'faith is not to have a perfect knowledge of things', 1, 1, 'p21', 'verse', 21),
        (11, 'Now faith is the substance of things hoped for', 2, 1, 'p1', 'verse', 1),
        (12, 'Chapter heading', 1, 0, 'h', 'heading', NULL),
        (13, 'one', 1, 2, 'p22', 'verse', 22);
    """)
    info = embed.embed_missing(conn, e)
    assert info["count"] == 2 and info["model"] == embed.MODEL_NAME and info["left"] == 0  # a heading and a one-word verse are skipped
    rows = conn.execute("SELECT paragraph_id, length(v) FROM vectors ORDER BY paragraph_id").fetchall()
    assert rows == [(10, 384), (11, 384)]
    # unchanged on a second pass, a vanished paragraph's vector dropped
    conn.execute("DELETE FROM paragraphs WHERE rowid = 11")
    assert embed.embed_missing(conn, e)["count"] == 1
    # the bits
    v10 = conn.execute("SELECT v FROM vectors WHERE paragraph_id = 10").fetchone()[0]
    bits = embed.to_bits(v10)
    assert len(bits) == 48
    arr = np.frombuffer(v10, dtype=np.int8)
    assert ((np.unpackbits(np.frombuffer(bits, dtype=np.uint8)) == 1) == (arr >= 0)).all()
    # the smoke test: the best passages for a query, scored against the int8 vectors (in chunks)
    smoke = embed.smoke_test(conn, e, ["faith", "hope"], k=3, chunk=1)
    assert [q for q, _ in smoke] == ["faith", "hope"] and len(smoke[0][1]) == 1 and isinstance(smoke[0][1][0][0], float)
    n = embed.pack_bits(conn)
    assert n == 1 and conn.execute("SELECT length(bits) FROM vecbits").fetchone()[0] == 48
    assert not conn.execute("SELECT 1 FROM sqlite_master WHERE name='vectors'").fetchone()
    conn.close()
