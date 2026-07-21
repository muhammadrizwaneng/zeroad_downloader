#!/bin/sh
set -e

# PO token server — bypasses YouTube bot checks on cloud/datacenter IPs.
node /opt/bgutil/server/build/main.js --port 4416 &

# Wait until bgutil responds (avoid yt-dlp hanging on a cold provider).
for _ in $(seq 1 30); do
  if curl -sf -X POST -H "Content-Type: application/json" -d "{}" http://127.0.0.1:4416/get_pot >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
