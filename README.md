# Gospel Library, personal edition

A private copy of the scriptures, every General Conference talk since 1971,
Preach My Gospel, Missionary Standards for Disciples of Jesus Christ, Come,
Follow Me, the General Handbook, and selected manuals, downloaded onto your
own iPhone and iPad and searched there in a few milliseconds, online or not.

- Search as you type, in plain language: "what did Nelson say about covenants
  and identity" becomes a search for covenant and identity (and their
  scriptural synonyms) in talks by President Nelson; "where does Alma teach
  about faith and knowledge" looks in Alma; "the holy spirit or spirit of god
  in PMG" searches each wording as the phrase it is; an exact phrase such as
  "plan of happiness" wins when it exists. A word the library has never seen
  ("spirt") is swapped for the nearest word it has. Power syntax still works:
  quotes, `-word`, `speaker:nelson`, `year:2015-2020`, `book:alma`,
  `in:conference`.
- Search by meaning, on the device. The nightly job embeds every verse and
  paragraph with a small sentence model (bge-small-en-v1.5, in its ONNX
  form) and the library carries the sign bits of those vectors (48 bytes a
  paragraph). The app fetches the same model once (35 MB, kept by the
  service worker) and runs it in a worker of its own with ONNX Runtime
  (loading it never stalls the search engine), so a search
  is ranked by its words and by what it means, fused by reciprocal rank
  (an exact phrase, when the library has it, is ranked first). A passage
  that says "trust in the Lord's timing" turns up for "patience with God's
  plan" even though no word is shared. Until the model has arrived, or on a
  browser that cannot run it, search goes by words alone and says so.
- Every match, when you want them all: the "800 with these words" count
  above the results opens a concordance, each passage in the order of the
  books under its chapter or talk with the count, the words marked, a tap
  from its place; Back returns to the ranked results. Chips at the head
  count each book ("Alma 83 · Ether 32") and narrow the list to one; an
  "Exact words | Word family" switch keeps faith apart from faithful; a "+"
  on each passage puts it on the deck.
- Results with their context. The best match is shown in its place, with
  the verse or paragraph before and after it, and Open, + Deck and Present
  right there. The other hits from the same chapter or talk are folded
  under it ("4 more in Alma 32"); hits found by meaning alone say so. The
  line above the results says how the search was read ("Exact phrase
  found, then by words and meaning: faith, perfect knowledge · all
  shelves") with an "Only exact words" switch.
- Think it through, from anywhere. The lamp in the reader bar (in the bottom
  bar on a phone), or "Think these through" above a set of results, hands
  the page or the results to Claude on the Ask tab, with
  anything you have selected: Claude studies the chapter, lesson or talk,
  searches the library itself, and comes back with what connects to it
  across the shelves, the Hebrew or Greek behind a key word, three questions
  to ask (what it says, what it means, what you will do, as Preach My
  Gospel teaches), each a question card on the deck in a tap, and a deck
  section to build from it, in one tap. The deck's own
  "Think it through" still studies a chain of passages already on the deck.
- Four places, always in reach: Library, Search, Deck and Ask, in a tab bar
  along the bottom of an iPhone and a rail down the left of an iPad, the
  current one marked and named at the top. Each keeps its place while you
  are in another; a tap on the tab you are in goes to its top.
- Settings, from the gear (on the rail, or beside "Library" on a phone): the
  text size, which the whole interface follows and not the page alone; what
  is on the device and whether the system has promised to keep it; your
  instructions to Claude; and the keyboard shortcuts, which "?" also lists.
- Export everything: one file from Settings with your highlights and notes,
  your study pages, your decks, your instructions to Claude and what it was
  asked to remember, to keep somewhere other than the device; Import brings
  it back. The API key and the passphrase are never in it.
- A Back that says where it leads. Every place has an address (a shelf and
  how far into it you are, a search, a page, Ask, Deck), so "‹ Alma 32" or
  "‹ Results" in the reader bar, and at the top of every list on a phone,
  retraces your steps exactly, cross-references included, with the scroll
  position kept; it works in the home-screen app, where there is no browser
  Back, and survives a reload. In the home-screen app a swipe in from the
  left edge goes back and from the right edge forward (in Safari the
  browser's own swipe does the same).
- The reader bar says where you are: the chapter or page by name ("Alma 32"),
  a tap on the name opens the book's chapters, and the arrows beside it (Left
  and Right on a keyboard) turn to the previous and next chapter without
  adding a Back step. With a keyboard, Cmd+F or Cmd+K is the search box and
  Cmd+[ is Back.
- Links stay in the app. A cross-reference, a footnote, a link from
  Missionary Standards to Preach My Gospel, however the Church's page
  writes the address (`alma/32?id=p21`, `alma/32.21-27`, a whole book, the
  old lds.org form): if the library holds it, the local copy opens. A verse
  shows first in a sheet where you are, with Open and Add to deck; a page or
  a book opens in place. Only a page the library does not hold goes to the
  web, and only online: a note at the bottom says it is not in your library
  and names the site, and its link opens it (a second tap, which the iPad
  home-screen app needs before it will open anything). Joseph Smith Papers
  links open the local page when the library holds it.
- Highlights and notes. Tap a verse or paragraph, then a color (yellow,
  green, blue, pink) or Note; the mark comes back whenever the page opens,
  outlasts library updates (it is kept by page address and paragraph, on
  the device), and is listed under My studies with the passage and the
  note, newest first, each a tap from its place. Think it through reads
  your marks on the page as earlier study and answers the notes that ask
  something. Export writes them all to a file; Import brings them back on
  another device.
- My studies: pages of your own, read inside the app. Add an HTML page (a
  study built with Claude, say), a Markdown file or plain text from Files;
  it is kept on the device, apart from the library, with its own look and
  its own scripts intact in a sandboxed frame, and every link in it to the
  scriptures or to a talk opens the library's copy. Think it through works
  on it too.
- Your studies in the library's flow: a search lists the studies that have
  the words typed ("In your studies"), each opening at the nearest heading;
  a chapter a study links to says so under its title; references written as
  plain words in a Markdown or text study ("see Alma 32:21") are links.
- The home screen: where you were (the last chapter or talk, the deck in
  progress), this week's Come, Follow Me lesson (read from the lessons'
  own dates, with Next week beside it), the shelves as tiles with what each
  holds, the latest conference, and a box to ask the library a question.
  The text size you set in the reader also sizes the result snippets, the
  best-match card, the sheets and the concordance; until you set one, it
  follows the size iOS asks for (Larger Text). Open a shelf and the
  search box searches only that shelf until you choose All again. With a
  Claude API key set, pressing return also has Claude propose a few more
  searches and folds their results in. On a phone the reader keeps its
  tools at the bottom, under the thumb: Present, Hebrew or Greek, text
  size, To deck, Think it through, and the page on the Church's site. An
  iPhone turned on its side keeps this one-pane layout.
- Type a reference (`Alma 32:21`, `d&c 76 22`, `js-h 1:17`) and jump straight to it.
- The Bible in its own languages. Open any chapter of the Old or New
  Testament and tap Hebrew (or Greek) in the reader bar: under every verse,
  each word of the original as a tile, with how it sounds and what it means
  (Psalm titles come as verse 0, as the Hebrew counts them). Tap a word for
  its grammar in plain words, its dictionary entry, how often it occurs and
  where, and every verse that has it. Greek words the KJV translators had
  that the critical text lacks are outlined (and the reverse dimmed), so
  the differences between the Textus Receptus and NA28 are visible. The
  search box takes Hebrew or Greek letters (points and accents optional), a
  Strong's number (`H2617`, `G26`) or `translit: chesed`, and an English
  search that is really a transliteration ("logos", "shalom") offers the
  word behind it. "What the marks mean", under the tiles, explains how to
  read them (the capital letter in a Hebrew word's sound is its stressed
  syllable, brackets are words the translators supplied, what the dotted
  and dashed marks say); a word's sheet links to the Topical Guide, Bible
  Dictionary and Guide to the Scriptures entries on its English word. The
  gloss on a tile is STEP's translators' reading of the word in that
  verse, not always the KJV's own word for it (the data carries no KJV
  alignment). Ask has the same text as tools (`original`, `lexicon`).
  The data is the STEP Bible's (Tyndale House, Cambridge; the Leningrad
  Codex, and the Greek of NA28 together with the Textus Receptus and the
  other editions, each word tagged and glossed), used under CC BY 4.0; see
  "A word on the content".
- Behind this word: search one English word ("faith") and a line under the
  search names the Hebrew and Greek words most often read that way, with how
  often; tap one for its sheet.
- Results are verses and paragraphs with the matches highlighted; open one and
  the whole chapter or talk is there with footnotes, speaker, session, and
  previous/next.
- Present: one verse or paragraph at a time, large, on a plain background, for
  a projector, a TV over AirPlay, or a tablet turned toward the room. Tap the
  screen icon in the reader (or press P, or double-tap a paragraph). Arrow
  keys, space, taps and swipes move through the text; Esc returns to reading.
  The controls, seen only by the speaker, carry a timer since Present began
  (tap it to reset) and the first words of the next passage.
- On an iPhone or iPad older than iOS 16.4, setup says so in plain words and
  how to update, instead of an engine error.
- The app opens from the device at once, on a weak signal or none. A new
  version downloads behind it, whole, and a line at the top offers it ("A new
  version is ready. Reload"); until then the version in use carries on.
- Deck: the passages you pick for a presentation. Tick a card under an Ask
  answer, tap + on a search result, or select verses while reading and choose
  Add to deck. On an iPad in landscape or a Mac the deck is a board on the
  right while you keep finding passages on the left; on a phone it is the
  Deck tab. Pressing Return on a new search, or sending a new question, while
  a deck is in progress asks whether to clear it: keep adding to it, save it
  as it is and start a new one, or delete it and start over.
  The Deck button in the header shows how many passages are on it, and the
  toast after an add has an Undo for five seconds that takes off exactly
  what that add put on.
- Page | Deck: on an iPad, once the deck is open and a page is too, a switch at
  the top of the right pane flips between them. Neither is closed: the page
  keeps its place and its selected verses while the board is up.
- Undo and Cancel on the board: every change to the deck (a connection made
  or removed, a highlight, a card removed or moved, a new deck, a saved deck
  opened or deleted) shows a toast with Undo, the board has its own Undo
  button for the last 30 changes, and Cmd+Z works. A link in progress, a
  drag, the label editor and the deck's sheets are all left by Cancel,
  Escape, a tap outside or Back. A card's citation opens its chapter at the
  verse.
- The board: each passage is a card. Tap the first and last word of a phrase
  to highlight it. Every highlight ends in a dot; drag the dot onto a phrase
  in another passage (or onto the passage itself) and an arrow is drawn
  between them, routed down the margin, with a numbered badge; name the
  connection ("fulfilled in", "same word", "defines", your own words) from
  the badge or the chip under the card. Arrows follow the cards as you scroll,
  reorder and re-wrap. Tap a highlight for Link to… (without dragging) or
  Remove. Under More, Add question and Add note put a slide of your own
  words on the deck (a question for the room, centered and bold; a thought
  or a line to say), and every card, passage or not, takes speaker notes,
  folded away until wanted, which go into the PowerPoint as the slide's
  notes and into the Markdown. The deck's Think it through reads them, and
  the verse before and after each passage, so the chain is studied in its
  setting.
- PowerPoint: give the deck a title, pick a theme, and download a .pptx
  written on the device. Royal is the default: a deep blue background, white
  Georgia type, gold for verse numbers, references and highlighted phrases.
  One passage per slide, long passages split at verse or sentence breaks,
  speaker and talk under a quote; each connection becomes a slide with the
  two excerpts in panels and the arrow between them, and the deck ends with
  the chain as one picture: the passages left to right in the order you
  arranged them, each arrow routed above the row with its label (backward
  links go under). "Think it through" on the deck sends the chain to Claude
  (your chosen model, thinking first): it comes back with labels for
  unlabeled arrows, connections worth drawing that you have not drawn (with
  the exact phrases), a key phrase for any passage you have not highlighted,
  a caption for the chain slide, and speaker notes; accept each one or all.
  Or present the deck straight from the iPad, in the same colors. "Markdown"
  gives the same deck as a note for Bear or any notes app (copy, or save a
  .md file): the passages as quotes with the highlights in bold, each
  connection, and the chain with its caption and notes.
- Ask: a question, or in Draft mode a request (a talk, a lesson, a zone
  conference training, a letter). Claude searches the library itself, with
  tools that run on the device: ranked search, every passage in any part of
  the library containing a word family or an exact phrase (for complete
  lists: "all the references to the Holy Ghost in Preach My Gospel"), and
  reading a chapter or talk in context. Every passage names its edition or
  volume (the service missionary edition of the Missionary Standards, this
  year's Come, Follow Me, the Topical Guide), and the tools can keep to one
  or leave one out, so "exclude the service missionary edition" is honored. It
  keeps searching until it has what it needs, then writes; when its searches
  run out it writes from what it found, so an answer always comes, and a call
  that stalls is stopped with a plain message to try again. Every passage found
  appears as a card under the answer (book and verse, or speaker, talk and
  conference, with the full text) that you can open, present, or tick onto
  the deck; the passages Claude cites are badged and listed first. It thinks
  before it answers and between searches (you watch the thinking go by), and
  reasons with everything it knows while taking its quotations from the
  library. Pick the model in settings: Fable 5.1, Opus 5.5, Sonnet 5.5 or
  Haiku 5.5. Runs on your own Claude API key (from console.anthropic.com),
  stored on the device and sent only to Anthropic.
- Ask answers the way you have told it to. Settings (the gear) hold "How I
  want Claude to answer", your standing instructions in your own words, and
  "What Claude should remember", dated notes you can edit; both are kept on
  the device and go with every question, draft, Think it through and deck
  chain. Claude can propose a note under an answer ("Remember this?"), saved
  only if you tap Save. Each request also says what this device holds and
  what it does not, the page you have open and the deck in progress; your
  study pages, highlights and notes can be searched; the thread survives a
  reload; the Ask button is Stop while an answer is on its way.
- Your own voice and skills, kept private. A skills file (how drafts should
  sound, a house style for answers, and whole pieces such as the weekly
  letter, which appears as its own mode beside Ask and Draft) travels sealed
  with the library, unlocked on the device with the same passphrase. It is
  never committed to the repository: hand it to the nightly job once through
  the workflow's `skills` input (a gzip, base64 blob), and it is kept
  encrypted with the job's state from then on.
- The Joseph Smith Papers. The nightly job also brings in josephsmithpapers.org,
  a series at a time (journals, then revelations and translations, histories,
  documents, and the administrative, legal and financial records), about 75
  minutes a night at one request every 1.2 seconds, so the whole of it arrives
  over a week or two. Each paper comes with its transcription (the editors'
  bracketed readings, deletions struck through), its footnotes, the people
  and places it names with their short biographies (tap a name), and its
  source note and historical introduction. A JS Papers shelf lists the
  series, volumes and papers; the JS Papers scope searches only them, and so
  does "in the Joseph Smith Papers" in a plain-language search; Ask can be
  pointed at them. Long papers (a journal, a history volume) come one page at
  a time with previous and next; short ones as one piece with page markers.
  Cite, in the reader bar, copies the Papers' own citation form (title,
  manuscript page, accessed date, address); when a paper is presented, each
  paragraph's manuscript page stays with it on the screen.
- Every night a job on GitHub checks churchofjesuschrist.org for anything new
  or changed and publishes a fresh library. The app offers the update when it
  sees one.

## How it is put together

| Piece | Where it runs | What it does |
|---|---|---|
| `gospel_library/` (Python) | GitHub Actions, nightly | Walks the site's tables of contents, fetches new and changed pages through the same content API the site's own reader uses, parses them into SQLite with an FTS5 full-text index. |
| `embed` | nightly, after the fetch | Embeds every new verse and paragraph with bge-small-en-v1.5 through onnxruntime (45 minutes a night until it has caught up; the model is cached between runs) and keeps the int8 vectors in the working database. `--smoke` prints the top passages for a few test questions into the job log. |
| `bundle` | end of the nightly job | Compacts the database, packs the vectors' sign bits, gzips it, encrypts it with your passphrase (AES-256-GCM, key from PBKDF2), writes the deltas from the last twelve builds (`delta.py`), publishes it all with the app, the model and ONNX Runtime to GitHub Pages. |
| `web/` | your devices | The app. `engine.js` runs SQLite compiled to WebAssembly inside a Web Worker and keeps the library in the browser's private storage (OPFS); `semantic.js` runs the search model in the same worker, with a WordPiece tokenizer written to match the one the nightly job uses. `app.js` is the interface; `ask.js` is the Claude layer (search planning with Haiku, answers with the model you pick, streamed straight from api.anthropic.com). The interface scripts are ES modules that share pure helpers in `lib/`: `cite.js` (short citations, surnames, the chapter of a reference), `markdown.js` (Ask's renderer and quotation check, also used for Markdown studies), `chunk.js` (passages cut to fit a slide), beside `scriptures.js`, `query.js` and `wordpiece.js`. |

The code is public and ordinary. The library file is public too, but unreadable
without the passphrase, which exists only in your GitHub secret and on your
devices.

## Setting it up (once)

1. **Repository.** This repository must be public for GitHub Pages to serve the
   app on the free plan (Settings, Danger Zone, Change visibility). Nothing
   sensitive is in it.
2. **Passphrase.** Settings, Secrets and variables, Actions, New repository
   secret. Name: `LIBRARY_PASSPHRASE`. Value: a long passphrase you will type
   once on each device. A sentence works well. Keep it somewhere safe.
3. **First build.** Actions tab, "Library sync", Run workflow. The first run
   pulls everything from the site at a polite pace and takes a couple of hours;
   after that, nightly runs take minutes. The run ends by publishing the app at
   `https://YOUR-USERNAME.github.io/gospel-library/`.
4. **Devices.** Open that address in Safari on the iPhone and iPad. Tap Share,
   then **Add to Home Screen**, and open it from there (this is what lets the
   library stay on the device). Enter the passphrase; the library downloads
   once and everything works from then on, offline included.

Nightly runs that change nothing publish nothing. When conference talks or
edits arrive, the app shows "A newer library is available: 12 pages changed,
3.1 MB to download" and, when you tap it, downloads only what changed. Each
build keeps a snapshot of what it published and writes a sealed delta from
each of the last twelve builds (`data/delta-<version>.bin`, listed in the
manifest): the pages added or changed with their paragraphs, footnotes and
meaning vectors, the pages removed, the small tables whole. The app applies
it in place in one transaction and keeps it only if the result is, byte for
byte of content, the published library (the version is recomputed on the
device and compared); anything else, or a device more than twelve builds
behind, falls back to downloading the whole library as before.

## What gets pulled, and how

The collections live at the bottom of `gospel_library/config.py`. Each has a
list of site URIs (without the `/study` prefix). A root that does not exist
yet, such as next year's Come, Follow Me, is skipped quietly and tried again
each night, so new manuals appear on their own when the Church posts them.

For each book the sync reads the table of contents, fetches pages it has not
seen, and re-reads a budgeted number of pages whose turn has come: a new
conference talk is checked again after a week (small edits are common in the
weeks after conference), then the interval doubles each time it comes back
unchanged, up to four months. Requests go out one every half second, never in
parallel, and robots.txt is honored. Pages the site says it does not have are
retried on a backing-off schedule.

Between runs the job keeps its working state (the database, raw copies of
every page, and the private skills file if one was handed in) as encrypted
assets on a release named `state`.

To hand in or replace the skills file: `gzip -9c skills.json | base64 -w0`,
then run the workflow with that text as the `skills` input (from the Actions
tab, or `gh api -X POST repos/OWNER/gospel-library/actions/workflows/sync.yml/dispatches -f ref=main -f "inputs[skills]=$(...)"`).
The file is JSON: `{"voice": "...", "style": "...", "skills": [{"id":
"weekly-letter", "name": "Letter", "kind": "mode", "description": "...",
"placeholder": "...", "week1": "2026-06-28", "text": "..."}]}`. `voice` is
prepended to every draft, `style` to every answer, and each `kind: "mode"`
skill becomes a mode of its own.

## Working on it locally

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q                                  # tests
.venv/bin/python -m gospel_library seed                        # public-domain scripture text in seconds
.venv/bin/python -m gospel_library sync --collections scriptures --max-requests 50
.venv/bin/python -m gospel_library search "plan of happiness"
.venv/bin/python -m gospel_library embed --minutes 5 --smoke          # meaning vectors (downloads the model once, 35 MB)
LIBRARY_PASSPHRASE=test .venv/bin/python -m gospel_library bundle --out data/bundle
.venv/bin/python -m gospel_library serve                       # app at http://localhost:8777 using data/bundle
.venv/bin/python -m gospel_library discover /manual            # see what the site offers under a URI
```

The JavaScript has tests of its own: `node --test tests/js/*.test.mjs` parses
every file under `web/` and `web/lib/` as the module it is loaded as (plain
`node --check` reads a `.js` file as a script and lets a duplicate declaration
through), checks that the browser's parsers (`web/lib/scriptures.js`, `web/lib/query.js`) read
references and queries exactly as the Python ones do (against
`tests/fixtures/parsers.json`, frozen from the Python side), and
`tests/js/browser/run.mjs` drives the app itself in Chromium at iPad and
phone sizes (the trail and Back, links and My studies, highlights and notes,
the concordance, focus, deck cards, the tile legend, a delta built by the
Python and applied on the device, a second tab, a search fuzz); its header says how to
serve a copy for it to point at.

`bin/gen-web-data.py` regenerates `web/lib/scriptures-data.js` if the scripture
metadata changes. Data lives in `data/` (ignored by git); set
`GOSPEL_LIBRARY_DATA` to put it elsewhere.

### Running the nightly job on a Mac instead

`install.sh` sets up the same sync as a launchd job on a Mac that stays on,
serving the app on your home network. It predates the GitHub edition and still
works, but the device-side library above needs nothing at home, so it is the
better default.

## If something is off

- **The app says the library file is not published yet.** The first workflow
  run has not finished, or Pages is not enabled. Check the Actions tab.
- **"That passphrase does not unlock this library."** The passphrase typed on
  the device differs from the `LIBRARY_PASSPHRASE` secret used to build it.
- **Pages fails in the workflow.** The repository is private; see step 1.
- **A talk or chapter looks wrong.** The sync log (attached to each workflow
  run as `sync-log`) says which pages produced no text. `discover` shows what a
  table of contents looks like now, and `rebuild` re-parses cached pages after a
  fix, without touching the site.

## A word on the content

The scripture text is public domain. Footnotes, chapter headings, conference
talks, manuals, and the handbook are copyrighted by Intellectual Reserve, Inc.
and offered by the Church for personal, noncommercial use, which is exactly
what this is. The published library file is encrypted for that reason; do not
share the passphrase or publish a decrypted copy.

The Joseph Smith Papers transcriptions, notes and introductions are The
Church Historian's Press's, © Intellectual Reserve, Inc., read from
josephsmithpapers.org under its terms of use for personal, noncommercial
study; each paper in the app links to its page there.

The Hebrew and Greek text, transliterations, glosses, Strong's numbers,
grammar and lexicons are data created by [STEP Bible](https://www.STEPBible.org)
based on work at Tyndale House, Cambridge, used under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); the source is
<https://STEPBible.github.io/STEPBible-Data>. The nightly job downloads the
files from there once (`python -m gospel_library originals`) and keeps the
loaded tables with its state; the app credits STEP Bible under every
chapter it shows and in every answer that draws on it.
