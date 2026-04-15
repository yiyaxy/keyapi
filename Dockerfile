FROM oven/bun:1 AS builder

WORKDIR /build
COPY web/package.json .
COPY web/bun.lock .
RUN bun install
COPY ./web .
COPY ./VERSION .
RUN DISABLE_ESLINT_PLUGIN='true' VITE_REACT_APP_VERSION=$(cat VERSION) bun run build

FROM oven/bun:latest AS builder3

WORKDIR /build_v2
COPY frontend_v2/package.json .
COPY frontend_v2/package-lock.json .
RUN bun install
COPY ./frontend_v2 .
RUN bun run build

FROM golang:1.25.1-alpine3.22 AS builder2
ENV GO111MODULE=on CGO_ENABLED=0 GOPROXY=https://goproxy.cn,direct

ARG TARGETOS
ARG TARGETARCH
ENV GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64}

WORKDIR /build

ADD go.mod go.sum ./
RUN go mod download

COPY . .
COPY --from=builder /build/dist ./web/dist
RUN go build -ldflags "-s -w -X 'github.com/QuantumNous/new-api/common.Version=$(cat VERSION)'" -o new-api

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata libasan8 wget nginx \
    && rm -rf /var/lib/apt/lists/* \
    && update-ca-certificates

COPY --from=builder2 /build/new-api /
COPY --from=builder3 /build_v2/dist /var/www/frontend_v2
RUN rm -f /etc/nginx/sites-enabled/default
COPY docker/nginx-frontend-v2.conf /etc/nginx/sites-enabled/frontend-v2.conf
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 3000 4927
WORKDIR /data
ENTRYPOINT ["/entrypoint.sh"]
