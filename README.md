# Gospel Library, personal edition

A private copy of the scriptures, every General Conference talk since 1971,
Come, Follow Me, the General Handbook, and selected manuals, downloaded onto
your own iPhone and iPad and searched there in a few milliseconds, online or
not.

- Search as you type, across everything or one shelf. Exact phrases in quotes,
  `-word` to exclude, `speaker:nelson`, `year:2015-2020`, `book:alma`.
- Type a reference (`Alma 32:21`, `d&c 76 22`, `js-h 1:17`) and jump straight to it.
- Results are verses and paragraphs with the matches highlighted; open one and
  the whole chapter or talk is there with footnotes, speaker, session, and
  previous/next.
- Present: one verse or paragraph at a time, large, on a plain background, for
  a projector, a TV over AirPlay, or a tablet turned toward the room. Tap the
  screen icon in the reader (or press P, or double-tap a paragraph). Arrow
  keys, space, taps and swipes move through the text; Esc returns to reading.
- Every night a job on GitHub checks churchofjesuschrist.org for anything new
  or changed and publishes a fresh library. The app offers the update when it
  sees one.

## How it is put together

| Piece | Where it runs | What it does |
|---|---|---|
| `gospel_library/` (Python) | GitHub Actions, nightly | Walks the site's tables of contents, fetches new and changed pages through the same content API the site's own reader uses, parses them into SQLite with an FTS5 full-text index. |
| `bundle` | end of the nightly job | Compacts the database, gzips it, encrypts it with your passphrase (AES-256-GCM, key from PBKDF2), publishes it with the app to GitHub Pages. |
| `web/` | your devices | The app. `engine.js` runs SQLite compiled to WebAssembly inside a Web Worker and keeps the library in the browser's private storage (OPFS). `app.js` is the interface. |

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

Between runs the job keeps its working state (the database and raw copies of
every page) as encrypted assets on a release named `state`.

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
