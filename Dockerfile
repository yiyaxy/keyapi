# 第一阶段：前端构建 (Bun)
FROM oven/bun:latest AS builder

# 替换 Bun/Node 相关的源 (可选，如果 bun install 慢可以加)
WORKDIR /build
COPY web/package.json .
COPY web/bun.lock .
# 如果 bun install 依然慢，可以取消下面这行的注释使用淘宝镜像
# RUN bun config set registry https://registry.npmmirror.com
RUN bun install
COPY ./web .
COPY ./VERSION .
RUN DISABLE_ESLINT_PLUGIN='true' VITE_REACT_APP_VERSION=$(cat VERSION) bun run build

# 第二阶段：后端构建 (Golang)
FROM golang:alpine AS builder2

# 设置 Go 代理加速依赖下载 (非常关键)
ENV GO111MODULE=on \
  CGO_ENABLED=0 \
  GOPROXY=https://goproxy.cn,direct

ARG TARGETOS
ARG TARGETARCH
ENV GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64}
ENV GOEXPERIMENT=greenteagc

WORKDIR /build

ADD go.mod go.sum ./
RUN go mod download

COPY . .
COPY --from=builder /build/dist ./web/dist
RUN go build -ldflags "-s -w -X 'github.com/QuantumNous/new-api/common.Version=$(cat VERSION)'" -o new-api

# 第三阶段：最终运行镜像 (Debian)
FROM debian:bookworm-slim

# 关键改动：在 apt-get update 之前更换为国内镜像源
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources || \
  sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list && \
  apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tzdata libasan8 wget \
  && rm -rf /var/lib/apt/lists/* \
  && update-ca-certificates

COPY --from=builder2 /build/new-api /
EXPOSE 3000
WORKDIR /data
ENTRYPOINT ["/new-api"]