#!/bin/sh
# Starts Copy Slips (Linux / macOS) and opens the browser.
cd "$(dirname "$0")" && exec python3 app.py "$@"
