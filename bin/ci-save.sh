#!/bin/bash
# Nightly job, last step: seal tonight's library and keep it for tomorrow.
set -euo pipefail
: "${GOSPEL_LIBRARY_DATA:?set GOSPEL_LIBRARY_DATA}"
[ -f "$GOSPEL_LIBRARY_DATA/library.sqlite" ] || { echo "nothing to save"; exit 0; }
out="$(mktemp -d)"
python -m gospel_library seal "$GOSPEL_LIBRARY_DATA/library.sqlite" "$out/library.bin"
if [ -f "$GOSPEL_LIBRARY_DATA/raw.sqlite" ]; then
  python -m gospel_library seal "$GOSPEL_LIBRARY_DATA/raw.sqlite" "$out/raw.bin" --no-compress
fi
if ! gh release view state >/dev/null 2>&1; then
  gh release create state --prerelease --title "Nightly sync state (encrypted)" \
    --notes "Working state for the nightly library sync. Encrypted with the library passphrase. Nothing here is meant to be downloaded by hand."
fi
gh release upload state "$out"/*.bin --clobber
rm -rf "$out"
echo "State saved."
