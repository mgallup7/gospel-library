"""Command line: python -m gospel_library <command>

  sync        pull new and changed pages from the site (what the nightly job runs)
  serve       run the web app and search API
  seed        load public-domain scripture text so search works right away
  stats       what is in the library
  discover    list what the site offers under a URI (for adding collections)
  rebuild     re-parse every cached page without using the network
  search      try a query from the terminal
  doctor      check that the site is reachable and the API answers
"""

from __future__ import annotations

import argparse
import datetime as dt
import logging
import sys
import time
from pathlib import Path

from . import config


def _logging(verbose: bool, to_file: bool) -> None:
    config.ensure_dirs()
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(message)s", "%H:%M:%S")
    root = logging.getLogger()
    root.setLevel(logging.DEBUG if verbose else logging.INFO)
    out = logging.StreamHandler(sys.stdout)
    out.setFormatter(fmt)
    root.addHandler(out)
    if to_file:
        path = config.LOG_DIR / f"{dt.date.today():%Y-%m-%d}.log"
        fh = logging.FileHandler(path, encoding="utf-8")
        fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(name)s %(message)s"))
        root.addHandler(fh)
        _prune_logs()
    logging.getLogger("urllib3").setLevel(logging.WARNING)


def _prune_logs(keep_days: int = 60) -> None:
    cutoff = time.time() - keep_days * 86400
    for f in config.LOG_DIR.glob("*.log"):
        try:
            if f.stat().st_mtime < cutoff:
                f.unlink()
        except OSError:
            pass


def cmd_sync(args) -> int:
    from .db import Store
    from .fetch import Fetcher
    from .sync import Syncer

    store = Store()
    fetcher = Fetcher()
    slugs = [s.strip() for s in args.collections.split(",")] if args.collections else None
    syncer = Syncer(store, fetcher, max_requests=args.max_requests, full=args.full)
    counts = syncer.run(slugs, recheck_budget=args.recheck)
    store.close()
    return 1 if counts["errors"] and not (counts["added"] or counts["changed"] or counts["checked"]) else 0


def cmd_serve(args) -> int:
    from .server import serve

    serve(args.host, args.port)
    return 0


def cmd_seed(args) -> int:
    from .db import Store
    from .seed import seed

    store = Store()
    n = seed(store, Path(args.source) if args.source else None)
    logging.getLogger("gospel").info("seeded %d chapters", n)
    store.close()
    return 0


def cmd_stats(args) -> int:
    from . import db

    conn = db.connect(config.DB_PATH)
    s = db.stats(conn)
    print(f"Library: {config.DB_PATH}")
    for c in s["collections"]:
        print(f"  {c['title']:<22} {c['docs']:>6} pages  {c['words']:>10,} words  (last fetched {c['last_fetched'] or 'never'})")
    print(f"  {'paragraphs indexed':<22} {s['paragraphs']:>6,}")
    print(f"  {'verses':<22} {s['verses']:>6,}")
    if s["latest_conference"]:
        lc = s["latest_conference"]
        print(f"  latest conference      {'April' if lc['month'] == 4 else 'October'} {lc['year']}")
    if s["last_run"]:
        r = s["last_run"]
        print(f"  last sync              {r['started_at']} -> {r['finished_at'] or 'running'}: "
              f"+{r['added']} ~{r['changed']} checked {r['checked']} errors {r['errors']} requests {r['requests']}")
    return 0


def cmd_discover(args) -> int:
    from .fetch import Fetcher
    from . import toc

    f = Fetcher()
    uri = args.uri
    state = f.page_state(uri)
    found = toc.from_state(state, uri)
    if found and found.nodes:
        print(f"{found.title}  ({found.content_type})  {len(found.content_nodes)} pages")
        for n in found.nodes:
            indent = "  " * n.depth
            mark = "#" if n.kind == "section" else "-"
            sub = f"  [{n.subtitle}]" if n.subtitle else ""
            print(f"{indent}{mark} {n.title}{sub}  {n.uri or ''}")
        return 0
    entries = toc.library_entries(state)
    if entries:
        print(f"Library listing for {uri}: {len(entries)} entries")
        for n in entries:
            sub = f"  [{n.subtitle}]" if n.subtitle else ""
            print(f"- {n.title}{sub}  {n.uri}")
        return 0
    print("No table of contents or library listing found in that page's state.")
    print("Top-level state keys:", ", ".join(sorted(state.keys())))
    return 1


def cmd_rebuild(args) -> int:
    from .db import Store
    from .fetch import Fetcher
    from .sync import Syncer

    store = Store()
    syncer = Syncer(store, Fetcher(offline=True))
    slugs = [s.strip() for s in args.collections.split(",")] if args.collections else None
    syncer.rebuild(slugs)
    store.close()
    return 0


def cmd_search(args) -> int:
    from . import db, search

    conn = db.connect(config.DB_PATH)
    t0 = time.monotonic()
    res = search.search(conn, " ".join(args.query), scope=args.scope, limit=args.limit)
    ms = (time.monotonic() - t0) * 1000
    if res.get("jump"):
        j = res["jump"]
        print(f"-> {j['label']}  {j['uri']}  (doc {j['doc_id']})")
    for t in res.get("titles", []):
        print(f"TITLE  {t['title']}  — {t['author'] or ''} {t['label']}")
    for h in res["hits"]:
        snippet = h["snippet"].replace("<mark>", "[").replace("</mark>", "]")
        print(f"{h['citation']}\n    {snippet}")
    print(f"{res['total']} hits in {ms:.1f} ms" + (f"  error: {res['error']}" if res.get("error") else ""))
    return 0


def cmd_bundle(args) -> int:
    from . import bundle

    passphrase = _passphrase(args)
    m = bundle.build(Path(args.out), passphrase)
    print(f"library.bin {m['bundle_size'] / 1e6:.1f} MB (uncompressed {m['plain_size'] / 1e6:.1f} MB), "
          f"version {m['version']}, {m['documents']} documents, {m['verses']:,} verses, {m['talks']:,} talks")
    return 0


def cmd_seal(args) -> int:
    """Encrypt any file (used for the nightly job's state)."""
    from . import bundle

    h = bundle.encrypt_file(Path(args.src), Path(args.dst), _passphrase(args), compress=not args.no_compress)
    print(f"{args.dst}: {h['bundle_size'] / 1e6:.1f} MB")
    return 0


def cmd_unseal(args) -> int:
    from . import bundle

    bundle.decrypt_file(Path(args.src), Path(args.dst), _passphrase(args))
    print(f"{args.dst}: {Path(args.dst).stat().st_size / 1e6:.1f} MB")
    return 0


def _passphrase(args) -> str:
    import os

    value = os.environ.get(args.passphrase_env or "LIBRARY_PASSPHRASE", "")
    if not value:
        raise SystemExit(f"set {args.passphrase_env or 'LIBRARY_PASSPHRASE'} to the library passphrase")
    return value


def cmd_doctor(args) -> int:
    from .fetch import Fetcher, FetchError

    f = Fetcher()
    ok = True
    for label, fn in (
        ("content API, Alma 32", lambda: f.content("/scriptures/bofm/alma/32")),
        ("page state, April 2026 conference", lambda: f.page_state("/general-conference/2026/04")),
    ):
        t0 = time.monotonic()
        try:
            data = fn()
            size = len(str(data))
            print(f"ok    {label}: {size:,} bytes in {time.monotonic() - t0:.1f}s")
        except FetchError as exc:
            ok = False
            print(f"FAIL  {label}: {exc}")
    print(f"data directory: {config.DATA_DIR}")
    return 0 if ok else 1


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="gospel_library", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="command", required=True)

    s = sub.add_parser("sync", help="fetch new and changed pages")
    s.add_argument("--collections", help="comma-separated slugs, e.g. scriptures,general-conference")
    s.add_argument("--full", action="store_true", help="re-fetch everything, not just what is missing")
    s.add_argument("--max-requests", type=int, help="stop after this many HTTP requests (for trying things out)")
    s.add_argument("--recheck", type=int, help="how many already-stored pages to re-check tonight")
    s.set_defaults(fn=cmd_sync, to_file=True)

    s = sub.add_parser("serve", help="run the web app")
    s.add_argument("--host", default=config.SERVER_HOST)
    s.add_argument("--port", type=int, default=config.SERVER_PORT)
    s.set_defaults(fn=cmd_serve, to_file=True)

    s = sub.add_parser("seed", help="load public-domain scripture text")
    s.add_argument("--source", help="directory holding the *-flat.json files (otherwise downloaded)")
    s.set_defaults(fn=cmd_seed, to_file=True)

    s = sub.add_parser("stats", help="what is in the library")
    s.set_defaults(fn=cmd_stats, to_file=False)

    s = sub.add_parser("discover", help="list what the site offers under a URI")
    s.add_argument("uri", help="e.g. /manual or /general-conference/2026/04")
    s.set_defaults(fn=cmd_discover, to_file=False)

    s = sub.add_parser("rebuild", help="re-parse cached pages offline")
    s.add_argument("--collections")
    s.set_defaults(fn=cmd_rebuild, to_file=True)

    s = sub.add_parser("search", help="search from the terminal")
    s.add_argument("query", nargs="+")
    s.add_argument("--scope")
    s.add_argument("--limit", type=int, default=10)
    s.set_defaults(fn=cmd_search, to_file=False)

    s = sub.add_parser("bundle", help="build the encrypted device bundle (library.bin + manifest.json)")
    s.add_argument("--out", default="site/data")
    s.add_argument("--passphrase-env", default="LIBRARY_PASSPHRASE")
    s.set_defaults(fn=cmd_bundle, to_file=False)

    s = sub.add_parser("seal", help="encrypt a file with the library passphrase")
    s.add_argument("src")
    s.add_argument("dst")
    s.add_argument("--no-compress", action="store_true")
    s.add_argument("--passphrase-env", default="LIBRARY_PASSPHRASE")
    s.set_defaults(fn=cmd_seal, to_file=False)

    s = sub.add_parser("unseal", help="decrypt a sealed file")
    s.add_argument("src")
    s.add_argument("dst")
    s.add_argument("--passphrase-env", default="LIBRARY_PASSPHRASE")
    s.set_defaults(fn=cmd_unseal, to_file=False)

    s = sub.add_parser("doctor", help="check connectivity to the site")
    s.set_defaults(fn=cmd_doctor, to_file=False)

    args = p.parse_args(argv)
    _logging(args.verbose, args.to_file)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
