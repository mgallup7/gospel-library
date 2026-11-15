#!/bin/bash
# Nightly job, step 1: bring back last night's library so tonight is incremental.
# The state lives as encrypted assets on a rolling GitHub release called "state".
set -euo pipefail
: "${GOSPEL_LIBRARY_DATA:?set GOSPEL_LIBRARY_DATA}"
mkdir -p "$GOSPEL_LIBRARY_DATA"
tmp="$(mktemp -d)"
# A saved state that cannot be fetched must stop the build. On November 15, 2026 a failed download
# was taken for "no state yet": the build started from an empty library and saved that over the
# real one. Starting from scratch is right only when the release holds no library at all.
have=""
for try in 1 2 3; do
  if listing="$(gh release view state --json assets --jq '.assets[].name' 2>&1)"; then have="$listing"; break; fi
  case "$listing" in *"release not found"*|*"Not Found"*) have=""; break;; esac
  echo "could not list the state release (try $try): $listing"; sleep 20
  [ "$try" = 3 ] && { echo "::error::The saved state could not be listed; stopping so nothing is overwritten."; exit 1; }
done
if echo "$have" | grep -qx 'library.bin'; then
  ok=""
  for try in 1 2 3; do
    rm -rf "$tmp"/*
    if gh release download state --pattern 'library.bin' --pattern 'raw.bin' --pattern 'skills.bin' --dir "$tmp" && [ -s "$tmp/library.bin" ]; then ok=1; break; fi
    echo "download of the saved state failed (try $try)"; sleep 30
  done
  [ -n "$ok" ] || { echo "::error::The saved state exists but could not be downloaded; stopping so it is not overwritten."; exit 1; }
fi
if [ -f "$tmp/library.bin" ]; then
  python -m gospel_library unseal "$tmp/library.bin" "$GOSPEL_LIBRARY_DATA/library.sqlite"
  if [ -f "$tmp/raw.bin" ]; then
    python -m gospel_library unseal "$tmp/raw.bin" "$GOSPEL_LIBRARY_DATA/raw.sqlite"
  fi
  # The owner's skills arrive already sealed (python -m gospel_library seal-skills, on his own
  # machine) and are published as they are: never unsealed here, so no log can hold them.
  if [ -f "$tmp/skills.bin" ]; then
    cp "$tmp/skills.bin" "$GOSPEL_LIBRARY_DATA/skills.bin"
  fi
  echo "Restored previous state."
else
  echo "No previous state found; this run builds the library from scratch (a couple of hours)."
fi
rm -rf "$tmp"
