#!/bin/bash
# Run the web app in the foreground (launchd uses this; handy for testing too).
cd "$(dirname "$0")/.." || exit 1
exec .venv/bin/python -m gospel_library serve
