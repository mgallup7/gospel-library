# Gospel Library, personal edition

A private copy of the scriptures, every General Conference talk since 1971,
Come, Follow Me, the General Handbook, and selected manuals, downloaded onto
your own iPhone and iPad and searched there in a few milliseconds, online or
not.

- Search as you type, in plain language: "what did Nelson say about covenants
  and identity" becomes a search for covenant and identity (and their
  scriptural synonyms) in talks by President Nelson; "where does Alma teach
  about faith and knowledge" looks in Alma; "the holy spirit or spirit of god
  in PMG" searches each wording as the phrase it is; an exact phrase such as
  "plan of happiness" wins when it exists. A word the library has never seen
  ("spirt") is swapped for the nearest word it has. The results say how the
  question was read, with an "Exact words" switch. With a Claude API key set, pressing return
  also has Claude propose a few more searches and folds their results in.
  Power syntax still works: quotes, `-word`, `speaker:nelson`,
  `year:2015-2020`, `book:alma`, `in:conference`.
- Type a reference (`Alma 32:21`, `d&c 76 22`, `js-h 1:17`) and jump straight to it.
- Results are verses and paragraphs with the matches highlighted; open one and
  the whole chapter or talk is there with footnotes, speaker, session, and
  previous/next.
- Present: one verse or paragraph at a time, large, on a plain background, for
  a projector, a TV over AirPlay, or a tablet turned toward the room. Tap the
  screen icon in the reader (or press P, or double-tap a paragraph). Arrow
  keys, space, taps and swipes move through the text; Esc returns to reading.
- Deck: the passages you pick for a presentation. Tick a card under an Ask
  answer, tap + on a search result, or select verses while reading and choose
  Add to deck. On an iPad in landscape or a Mac the deck is a board on the
  right while you keep finding passages on the left; on a phone it is the
  Deck tab. Pressing Return on a new search, or sending a new question, while
  a deck is in progress asks whether to clear it: keep adding to it, save it
  as it is and start a new one, or delete it and start over.
- The board: each passage is a card. Tap the first and last word of a phrase
  to highlight it. Every highlight ends in a dot; drag the dot onto a phrase
  in another passage (or onto the passage itself) and an arrow is drawn
  between them, routed down the margin, with a numbered badge; name the
  connection ("fulfilled in", "same word", "defines", your own words) from
  the badge or the chip under the card. Arrows follow the cards as you scroll,
  reorder and re-wrap. Tap a highlight for Link to… (without dragging) or
  Remove.
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
  Or present the deck straight from the iPad, in the same colors.
- Ask: a question, or in Draft mode a request (a talk, a lesson, a zone
  conference training, a letter). Claude searches the library itself, with
  tools that run on the device: ranked search, every passage in any part of
  the library containing a word family or an exact phrase (for complete
  lists: "all the references to the Holy Ghost in Preach My Gospel"), and
  reading a chapter or talk in context. It
  keeps searching until it has what it needs, then writes. Every passage found
  appears as a card under the answer (book and verse, or speaker, talk and
  conference, with the full text) that you can open, present, or tick onto
  the deck; the passages Claude cites are badged and listed first. It thinks
  before it answers and between searches (you watch the thinking go by), and
  reasons with everything it knows while taking its quotations from the
  library. Pick the model in settings: Fable 5.1, Opus 5.5, Sonnet 5.5 or
  Haiku 5.5. Runs on your own Claude API key (from console.anthropic.com),
  stored on the device and sent only to Anthropic.
- Your own voice and skills, kept private. A skills file (how drafts should
  sound, a house style for answers, and whole pieces such as the weekly
  letter, which appears as its own mode beside Ask and Draft) travels sealed
  with the library, unlocked on the device with the same passphrase. It is
  never committed to the repository: hand it to the nightly job once through
  the workflow's `skills` input (a gzip, base64 blob), and it is kept
  encrypted with the job's state from then on.
- Every night a job on GitHub checks churchofjesuschrist.org for anything new
  or changed and publishes a fresh library. The app offers the update when it
  sees one.

## How it is put together

| Piece | Where it runs | What it does |
|---|---|---|
| `gospel_library/` (Python) | GitHub Actions, nightly | Walks the site's tables of contents, fetches new and changed pages through the same content API the site's own reader uses, parses them into SQLite with an FTS5 full-text index. |
| `bundle` | end of the nightly job | Compacts the database, gzips it, encrypts it with your passphrase (AES-256-GCM, key from PBKDF2), publishes it with the app to GitHub Pages. |
| `web/` | your devices | The app. `engine.js` runs SQLite compiled to WebAssembly inside a Web Worker and keeps the library in the browser's private storage (OPFS). `app.js` is the interface; `ask.js` is the Claude layer (search planning with Haiku, answers with the model you pick, streamed straight from api.anthropic.com). |

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
edits arrive, the app shows "A newer library is available" and updates in the
background when you tap it.

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
LIBRARY_PASSPHRASE=test .venv/bin/python -m gospel_library bundle --out data/bundle
.venv/bin/python -m gospel_library serve                       # app at http://localhost:8777 using data/bundle
.venv/bin/python -m gospel_library discover /manual            # see what the site offers under a URI
```

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
