"""Paths, network manners, and the list of collections to keep in sync.

Everything a person might reasonably want to change lives here. The data
directory can be moved with the GOSPEL_LIBRARY_DATA environment variable.
"""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.environ.get("GOSPEL_LIBRARY_DATA", ROOT / "data")).expanduser()
LOG_DIR = DATA_DIR / "logs"
DB_PATH = DATA_DIR / "library.sqlite"
RAW_DB_PATH = DATA_DIR / "raw.sqlite"
WEB_DIR = ROOT / "web"
RESOURCES = Path(__file__).resolve().parent / "resources"

# --- Network manners -------------------------------------------------------
HOST = "https://www.churchofjesuschrist.org"
CONTENT_API = f"{HOST}/study/api/v3/language-pages/type/content"
LANG = "eng"

# The site serves its reader to browsers; a browser-like agent string is what
# it expects. The suffix identifies this tool so a sysadmin can see what it is.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36 GospelLibraryPersonal/1.0"
)
MIN_INTERVAL = float(os.environ.get("GOSPEL_LIBRARY_MIN_INTERVAL", "0.5"))  # seconds between requests
TIMEOUT = (15, 60)  # connect, read
MAX_ATTEMPTS = 5

# --- Refresh policy --------------------------------------------------------
# A document fetched for the first time is checked again after RECHECK_FIRST
# days (conference talks get small edits in the weeks after a conference),
# and the interval doubles each time it comes back unchanged, up to the cap.
RECHECK_FIRST_DAYS = 7
RECHECK_MAX_DAYS = 120
NIGHTLY_RECHECK_BUDGET = int(os.environ.get("GOSPEL_LIBRARY_RECHECK_BUDGET", "400"))

# --- Server ----------------------------------------------------------------
SERVER_HOST = os.environ.get("GOSPEL_LIBRARY_HOST", "0.0.0.0")
SERVER_PORT = int(os.environ.get("GOSPEL_LIBRARY_PORT", "8777"))

# --- Collections -----------------------------------------------------------
# kind:
#   books        a set of book roots; each root's table of contents is walked
#                and every content page under it is fetched
#   conference   general conference, one book per conference (year, month)
#
# Roots are site URIs without the /study prefix, as the content API wants them.
FIRST_CONFERENCE_YEAR = 1971

COLLECTIONS: list[dict] = [
    {
        "slug": "scriptures",
        "title": "Scriptures",
        "kind": "books",
        "roots": [
            "/scriptures/ot",
            "/scriptures/nt",
            "/scriptures/bofm",
            "/scriptures/dc-testament",
            "/scriptures/pgp",
            "/scriptures/jst",
        ],
    },
    {
        "slug": "general-conference",
        "title": "General Conference",
        "kind": "conference",
    },
    {
        "slug": "come-follow-me",
        "title": "Come, Follow Me",
        "kind": "books",
        # The current year's manual plus next year's once it is published.
        # Roots that do not exist yet are skipped quietly and retried nightly.
        "roots": [
            "/manual/come-follow-me-for-home-and-church-old-testament-2026",
            "/manual/come-follow-me-for-home-and-church-new-testament-2027",
            "/manual/come-follow-me-for-home-and-church-doctrine-and-covenants-2025",
        ],
    },
    {
        "slug": "handbook",
        "title": "General Handbook",
        "kind": "books",
        "roots": ["/manual/general-handbook"],
    },
    {
        "slug": "preach-my-gospel",
        "title": "Preach My Gospel",
        "kind": "books",
        "roots": ["/manual/preach-my-gospel-2023"],
    },
    {
        "slug": "manuals",
        "title": "Manuals",
        "kind": "books",
        "roots": [
            "/manual/teaching-in-the-saviors-way-2022",
            "/manual/for-the-strength-of-youth",
            "/manual/gospel-topics",
        ],
    },
    {
        "slug": "study-helps",
        "title": "Study Helps",
        "kind": "books",
        # Topical Guide, Bible Dictionary, Guide to the Scriptures. Thousands of
        # small pages, so this collection is synced last.
        "roots": ["/scriptures/tg", "/scriptures/bd", "/scriptures/gs"],
    },
]


def collection(slug: str) -> dict:
    for c in COLLECTIONS:
        if c["slug"] == slug:
            return c
    raise KeyError(slug)


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
