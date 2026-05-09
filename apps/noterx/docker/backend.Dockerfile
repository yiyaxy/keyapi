# NoteRx backend image
# Single-stage: python:3.11-slim with FastAPI + opencv-headless + ffmpeg
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# ffmpeg is required when VIDEO_STT_ENABLED=1 (audio extraction for whisper).
# tini gives clean PID 1 signal handling for uvicorn.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first so code edits don't bust the layer cache.
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install -r backend/requirements.txt

# main.py reads docs/*.html via ../../docs/, scripts/ holds the bootstrap.
COPY backend/ ./backend/
COPY scripts/ ./scripts/
COPY docs/ ./docs/

# Bootstrap script is mounted into the image, not the host volume.
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# baseline.db, temp_videos, noterx_workspace all live here. Bind-mount in compose.
RUN mkdir -p /app/backend/data
VOLUME ["/app/backend/data"]

WORKDIR /app/backend

EXPOSE 8000

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
