#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/bin/yt-dlp"

mkdir -p "$ROOT/bin"

echo "Downloading yt-dlp_macos standalone binary..."
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos -o "$BIN"
chmod +x "$BIN"

echo "Installed: $BIN"
"$BIN" --version
