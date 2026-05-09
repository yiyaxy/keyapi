#!/bin/sh
# NoteRx backend bootstrap.
# Runs scripts/init_db.py + seed_data.py + compute_baseline.py the first time
# the data volume is empty, then exec's the CMD (uvicorn).
set -e

DATA_DIR=/app/backend/data
DB_PATH="$DATA_DIR/baseline.db"

mkdir -p "$DATA_DIR" "$DATA_DIR/temp_videos" "$DATA_DIR/noterx_workspace"

if [ ! -f "$DB_PATH" ]; then
    echo "[noterx-bootstrap] $DB_PATH not found, initializing..."
    cd /app
    python scripts/init_db.py
    python scripts/seed_data.py
    python scripts/compute_baseline.py
    echo "[noterx-bootstrap] done."
fi

exec "$@"
