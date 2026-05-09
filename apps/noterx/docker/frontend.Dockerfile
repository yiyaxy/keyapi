# NoteRx frontend image
# Stage 1: build SPA with Vite (base: '/noterx/')
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

# Vite's `base: '/noterx/'` means index.html references /noterx/assets/*,
# so we drop dist under /noterx/ inside the document root.
COPY --from=build /build/dist /usr/share/nginx/html/noterx

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
