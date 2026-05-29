# Build frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json* ./frontend/
WORKDIR /src/frontend
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Build backend
FROM golang:1.24-alpine AS backend-builder
WORKDIR /src/server

# Layer 1: module definition + vendor (changes only when deps change)
COPY server/go.mod server/go.sum* ./
COPY server/vendor/ ./vendor/

# Layer 2: pre-compile heavy vendor deps into Go build cache.
# modernc.org/sqlite contains ~9 MB generated Go files per platform and
# takes 30-90 min on low-power NAS CPUs. Caching this layer means that
# compilation only happens when dependencies themselves change.
RUN mkdir -p _warmup \
    && printf 'package main\n\nimport _ "modernc.org/sqlite"\n\nfunc main() {}\n' > _warmup/main.go \
    && CGO_ENABLED=0 GOOS=linux go build -mod=vendor -o /dev/null ./_warmup \
    && rm -rf _warmup

# Layer 3: application source (changes on every code edit)
COPY server/ ./

# Vendor deps are already in Go build cache — only app code recompiles
RUN CGO_ENABLED=0 GOOS=linux go build -mod=vendor -o /out/mpod ./cmd/mpod

# Final image
FROM alpine:3.22
RUN adduser -D -h /app mpod \
    && mkdir -p /data /app \
    && chown -R mpod:mpod /data /app
WORKDIR /app
COPY --from=frontend-builder /src/frontend/dist ./frontend/dist
COPY server/migrations ./migrations
COPY --from=backend-builder /out/mpod /usr/local/bin/mpod
USER mpod
EXPOSE 5050
CMD ["mpod"]
