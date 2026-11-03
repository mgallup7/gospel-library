"""Look at a web page the way the sync would, and report what is there.

Used from the nightly job's machine (which can reach the sites) before a
new source is added: whether robots.txt allows it, whether the text is in
the HTML or loaded by script, and which links a listing offers. Findings
are printed as GitHub Actions notices so they can be read from the API.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.parse
import urllib.robotparser

import requests
from bs4 import BeautifulSoup

from . import config


def notice(title: str, text: str) -> None:
    text = re.sub(r"\s+", " ", text).strip()
    for i in range(0, max(1, len(text)), 900):
        print(f"::notice title={title}::{text[i:i + 900]}")


def probe(url: str) -> int:
    session = requests.Session()
    session.headers["User-Agent"] = config.USER_AGENT
    session.headers["Accept-Language"] = "en-US,en;q=0.9"
    parts = urllib.parse.urlsplit(url)
    root = f"{parts.scheme}://{parts.netloc}"

    # robots.txt
    try:
        r = session.get(root + "/robots.txt", timeout=30)
        rp = urllib.robotparser.RobotFileParser()
        rp.parse(r.text.splitlines())
        allowed = rp.can_fetch(config.USER_AGENT, url)
        notice("robots", f"{root}/robots.txt status {r.status_code}; can fetch {url}: {allowed}; delay {rp.crawl_delay(config.USER_AGENT)}; text: {r.text[:1500]}")
    except Exception as e:  # noqa: BLE001
        notice("robots", f"could not read robots.txt: {e}")

    # the page
    r = session.get(url, timeout=60)
    html = r.text
    notice("page", f"status {r.status_code}; type {r.headers.get('Content-Type')}; {len(html)} chars; final url {r.url}")
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.get_text(" ", strip=True) if soup.title else ""
    scripts = soup.find_all("script")
    next_data = soup.find("script", id="__NEXT_DATA__")
    notice("structure", f"title: {title!r}; scripts {len(scripts)}; __NEXT_DATA__ {'yes ' + str(len(next_data.get_text())) + ' chars' if next_data else 'no'}; "
                        f"ids: {[t.get('id') for t in soup.find_all(id=True)][:40]}")
    classes = {}
    for t in soup.find_all(class_=True):
        for c in t.get("class", []):
            classes[c] = classes.get(c, 0) + 1
    top = sorted(classes.items(), key=lambda kv: -kv[1])[:60]
    notice("classes", "; ".join(f"{c}:{n}" for c, n in top))
    for t in soup(["script", "style", "noscript"]):
        t.decompose()
    text = soup.get_text(" ", strip=True)
    notice("text", f"{len(text)} chars of visible text. Start: {text[:2500]}")
    links = [a.get("href") for a in soup.find_all("a", href=True)]
    same = [h for h in links if h.startswith("/") or h.startswith(root)]
    notice("links", f"{len(links)} links, {len(same)} on site. Sample: {same[:80]}")
    if next_data:
        try:
            data = json.loads(next_data.get_text())
            keys = list(data.get("props", {}).get("pageProps", {}).keys())
            notice("next-data", f"pageProps keys: {keys[:40]}; head: {json.dumps(data)[:1500]}")
        except Exception as e:  # noqa: BLE001
            notice("next-data", f"unparsable: {e}")
    return 0


if __name__ == "__main__":
    sys.exit(probe(sys.argv[1]))
