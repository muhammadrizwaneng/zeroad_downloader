#!/bin/sh
set -e

# PO token server — bypasses YouTube bot checks on cloud/datacenter IPs.
node /opt/bgutil/server/build/main.js --port 4416 &
sleep 2

exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
