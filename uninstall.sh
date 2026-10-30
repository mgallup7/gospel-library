#!/bin/bash
# Removes the launchd agents. Keeps the data folder unless you delete it yourself.
cd "$(dirname "$0")"
UID_NUM="$(id -u)"
for label in com.gospel-library.server com.gospel-library.sync; do
  launchctl bootout "gui/$UID_NUM/$label" >/dev/null 2>&1 || true
  rm -f "$HOME/Library/LaunchAgents/$label.plist"
done
echo "Stopped the web app and the nightly sync. Your library is still in $(pwd)/data."
