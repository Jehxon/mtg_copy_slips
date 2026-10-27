#!/bin/sh
# Lance Copy Slips (Linux / macOS) puis ouvre le navigateur.
cd "$(dirname "$0")" && exec python3 app.py "$@"
