#!/bin/bash
# Gospel Library, personal edition: one-time setup on a Mac.
#
#   1. Python environment and dependencies
#   2. Scripture text loaded so search works immediately
#   3. The web app running now and at every login (launchd)
#   4. A nightly sync at 3:30 am (launchd), which also picks up code updates
#   5. The first full pull from churchofjesuschrist.org, started in the background
#
# Run it again any time; every step is safe to repeat.

set -euo pipefail
cd "$(dirname "$0")"
REPO="$(pwd)"
PORT="${GOSPEL_LIBRARY_PORT:-8777}"
LABEL_SERVER="com.gospel-library.server"
LABEL_SYNC="com.gospel-library.sync"
AGENTS="$HOME/Library/LaunchAgents"
UID_NUM="$(id -u)"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This installer is for macOS. On Windows use windows\\install.ps1; on Linux run the steps in README.md by hand."
  exit 1
fi

# --- 1. Python -------------------------------------------------------------
say "1. Python"
PY=""
for candidate in /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3 python3; do
  if command -v "$candidate" >/dev/null 2>&1; then
    if "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
      PY="$candidate"; break
    fi
  fi
done
if [ -z "$PY" ]; then
  echo "Python 3.9 or newer was not found."
  echo "Easiest fix: run   xcode-select --install   (Apple's command line tools include python3), then run this installer again."
  exit 1
fi
note "using $PY ($("$PY" --version 2>&1))"

if [ ! -x .venv/bin/python ]; then
  "$PY" -m venv .venv
fi
.venv/bin/python -m pip install --quiet --upgrade pip >/dev/null
.venv/bin/python -m pip install --quiet -r requirements.txt
note "dependencies installed"
mkdir -p data/logs

# --- 2. Scriptures right away -----------------------------------------------
say "2. Scripture text"
if .venv/bin/python -m gospel_library seed >/dev/null 2>&1; then
  note "standard works loaded (the full edition with footnotes arrives with the first sync)"
else
  note "could not load the quick scripture text; the sync will fetch everything instead"
fi

# --- 3 & 4. launchd agents ---------------------------------------------------
say "3. Web app and nightly sync"
mkdir -p "$AGENTS"
for label in "$LABEL_SERVER" "$LABEL_SYNC"; do
  sed -e "s|__REPO__|$REPO|g" "launchd/$label.plist" > "$AGENTS/$label.plist"
  launchctl bootout "gui/$UID_NUM/$label" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$UID_NUM" "$AGENTS/$label.plist"
done
launchctl kickstart -k "gui/$UID_NUM/$LABEL_SERVER" >/dev/null 2>&1 || true
sleep 2
if curl -s --max-time 5 "http://127.0.0.1:$PORT/api/stats" >/dev/null; then
  note "web app is running and will start at every login"
else
  note "web app did not answer yet; check data/logs/server.err"
fi
note "nightly sync scheduled for 3:30 am (runs on wake if the Mac was asleep)"

# --- 5. First sync -----------------------------------------------------------
say "4. First full pull from churchofjesuschrist.org"
if pgrep -f "gospel_library sync" >/dev/null; then
  note "a sync is already running"
else
  nohup bin/nightly.sh > data/logs/first-sync.out 2>&1 &
  note "started in the background; polite pace, roughly an hour for scriptures and all conference talks"
  note "follow along with:   tail -f $REPO/data/logs/first-sync.out"
fi

# --- Done --------------------------------------------------------------------
HOST_LOCAL="$(scutil --get LocalHostName 2>/dev/null || hostname -s).local"
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
say "Open it on your iPad (same Wi-Fi):"
note "http://$HOST_LOCAL:$PORT"
[ -n "$IP" ] && note "http://$IP:$PORT"
note "In Safari: Share, then 'Add to Home Screen'."
echo
note "If macOS asks whether python3 may accept incoming connections, choose Allow."
note "For access away from home see README.md (Tailscale gives a private https address in five minutes)."
echo
