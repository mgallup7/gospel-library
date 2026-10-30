# Gospel Library, personal edition

A private copy of the scriptures, every General Conference talk since 1971,
Come, Follow Me, the General Handbook, and selected manuals, kept on your own
Mac and searched from your iPad in a few milliseconds.

- Search as you type, across everything or one shelf. Exact phrases in quotes,
  `-word` to exclude, `speaker:nelson`, `year:2015-2020`, `book:alma`.
- Type a reference (`Alma 32:21`, `d&c 76 22`, `js-h 1:17`) and jump straight to it.
- Results are verses and paragraphs with the matches highlighted; open one and
  the whole chapter or talk is there with footnotes, speaker, session, and
  previous/next.
- Nightly, the Mac quietly checks the site for anything new or changed.

Everything stays on your machine. Nothing is sent anywhere except the page
requests to churchofjesuschrist.org.

## Install on the Mac (once)

```bash
git clone git@github.com:YOUR-USERNAME/gospel-library.git ~/gospel-library
cd ~/gospel-library
./install.sh
```

The installer sets up Python, loads the scripture text so search works right
away, starts the web app (and makes it start at every login), schedules the
nightly sync for 3:30 am, and begins the first full pull in the background.
The first pull runs at a polite pace: expect about an hour for the scriptures
and all conference talks, longer for the study helps. You can use the app
while it runs; new material appears as it lands.

If macOS asks whether `python3` may accept incoming connections, choose Allow.

## Open it on the iPad

On the same Wi-Fi, open Safari and go to the address the installer printed,
something like `http://mikes-mac-mini.local:8777`. Tap Share, then
**Add to Home Screen**. It opens full screen with its own icon from then on.

## Use it away from home (optional, five minutes)

[Tailscale](https://tailscale.com) is a free private network between your own
devices. Install it on the Mac and the iPad, sign in to the same account on
both, then on the Mac run:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:8777
```

Tailscale prints a private `https://your-mac.your-tailnet.ts.net` address that
works from anywhere the iPad has internet, with a real certificate and no port
forwarding. Add that address to the home screen instead; with `https` the app
shell also works offline for a moment if the Mac is briefly unreachable.

## Day to day

| What | How |
|---|---|
| See what is in the library | `.venv/bin/python -m gospel_library stats` |
| Run a sync now | `bin/nightly.sh` (or `.venv/bin/python -m gospel_library sync`) |
| Search from the terminal | `.venv/bin/python -m gospel_library search "plan of happiness"` |
| Check the site is reachable | `.venv/bin/python -m gospel_library doctor` |
| Look at what the site offers under a URI | `.venv/bin/python -m gospel_library discover /manual` |
| Logs | `data/logs/` (one file per day, plus `server.err` and `nightly.out`) |
| Stop everything | `./uninstall.sh` (keeps the data) |

Updates to the code land through `git pull`; the nightly job does that itself
and restarts the web app when something changed.

## What gets pulled, and how

The collections live at the bottom of `gospel_library/config.py`. Each has a
list of site URIs (without the `/study` prefix). A root that does not exist
yet, such as next year's Come, Follow Me, is skipped quietly and tried again
each night, so next year's manual appears on its own when the Church posts it.

For each book the sync reads the table of contents, fetches pages it has not
seen, and re-reads a budgeted number of pages whose turn has come: a new
conference talk is checked again after a week (small edits are common in the
weeks after conference), then the interval doubles each time it comes back
unchanged, up to four months. Requests go out one every half second, never in
parallel, and robots.txt is honored. Pages the site says it does not have are
retried on a backing-off schedule rather than every night.

Every page is also kept raw in `data/raw.sqlite`, so parsing can be improved and
re-run offline with `rebuild`.

## Where things are

| Path | Contents |
|---|---|
| `data/library.sqlite` | the library: documents, paragraphs, footnotes, full-text index |
| `data/raw.sqlite` | raw copies of every page fetched |
| `data/logs/` | logs |
| `gospel_library/` | scraper, database, search, server |
| `web/` | the app the iPad loads |
| `tests/` | `.venv/bin/python -m pip install -r requirements-dev.txt && .venv/bin/python -m pytest -q` |

Set `GOSPEL_LIBRARY_DATA=/some/other/folder` before installing to keep the data
elsewhere, and `GOSPEL_LIBRARY_PORT` to use a different port.

## If something is off

- **The iPad cannot reach it.** Both devices on the same Wi-Fi? Is the Mac
  awake? `curl http://127.0.0.1:8777/api/stats` on the Mac should print JSON;
  if it does not, read `data/logs/server.err`. Some routers isolate wireless
  clients from each other; Tailscale sidesteps that too.
- **The nightly sync did not run.** launchd runs it at the next wake if the Mac
  was asleep at 3:30. To keep the Mac awake for it: System Settings, Energy,
  prevent automatic sleeping when the display is off, or schedule a wake with
  `sudo pmset repeat wakeorpoweron MTWRFSU 03:25:00`.
- **Something on the site changed and pages stopped parsing.** The log says
  which pages produced no text. `discover` shows what a book's table of
  contents looks like now, and `rebuild` re-parses cached pages after a fix.

## A word on the content

The scripture text is public domain. Footnotes, chapter headings, conference
talks, manuals, and the handbook are copyrighted by Intellectual Reserve, Inc.
and offered by the Church for personal, noncommercial use, which is exactly
what this is. Keep the repository private and do not publish the data folder.
