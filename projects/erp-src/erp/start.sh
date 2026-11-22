#!/usr/bin/env bash
cd "$(dirname "$0")"
[ -f backend/erp.db ] || python3 -m backend.seed
exec python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8801
