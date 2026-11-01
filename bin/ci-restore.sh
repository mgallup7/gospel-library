#!/bin/bash
# Nightly job, step 1: bring back last night's library so tonight is incremental.
# The state lives as encrypted assets on a rolling GitHub release called "state".
set -euo pipefail
: "${GOSPEL_LIBRARY_DATA:?set GOSPEL_LIBRARY_DATA}"
mkdir -p "$GOSPEL_LIBRARY_DATA"
tmp="$(mktemp -d)"
if gh release download state --pattern 'library.bin' --pattern 'raw.bin' --pattern 'skills.bin' --dir "$tmp" 2>/dev/null && [ -f "$tmp/library.bin" ]; then
  python -m gospel_library unseal "$tmp/library.bin" "$GOSPEL_LIBRARY_DATA/library.sqlite"
  if [ -f "$tmp/raw.bin" ]; then
    python -m gospel_library unseal "$tmp/raw.bin" "$GOSPEL_LIBRARY_DATA/raw.sqlite"
  fi
  if [ -f "$tmp/skills.bin" ]; then
    python -m gospel_library unseal "$tmp/skills.bin" "$GOSPEL_LIBRARY_DATA/skills.json"
  fi
  echo "Restored previous state."
else
  echo "No previous state found; this run builds the library from scratch (a couple of hours)."
fi
rm -rf "$tmp"
