#!/bin/bash
# Nightly job: pick up any code updates, then sync the library.
# Installed by install.sh as a launchd agent; safe to run by hand.
set -u
cd "$(dirname "$0")/.." || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
mkdir -p data/logs

before=$(git rev-parse HEAD 2>/dev/null || echo none)
if [ -d .git ]; then
  git pull --ff-only --quiet 2>>data/logs/nightly.err || echo "$(date '+%F %T') git pull failed; using the code already here" >> data/logs/nightly.err
fi
after=$(git rev-parse HEAD 2>/dev/null || echo none)

if [ "$before" != "$after" ]; then
  echo "$(date '+%F %T') code updated $before -> $after"
  .venv/bin/pip install -q -r requirements.txt
  # restart the server so it runs the new code
  launchctl kickstart -k "gui/$(id -u)/com.gospel-library.server" 2>/dev/null || true
fi

exec .venv/bin/python -m gospel_library sync
