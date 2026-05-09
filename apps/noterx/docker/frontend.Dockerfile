# NoteRx frontend image
# Stage 1: build SPA with Vite (base: '/app/')
# Stage 2: serve dist + reverse-proxy non-SPA routes to backend container
FROM node:20-alpine AS build

WORKDIR /build

# Install with the lockfile for reproducible builds.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

# Vite's `base: '/app/'` means index.html references /app/assets/*,
# so we drop dist under /app/ inside the document root.
COPY --from=build /build/dist /usr/share/nginx/html/app

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
