# Build frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json* ./frontend/
WORKDIR /src/frontend
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Build backend
FROM golang:1.26.7-alpine3.24 AS backend-builder
RUN apk add --no-cache build-base
WORKDIR /src/server

# Layer 1: module definition + deps download (changes only when deps change)
COPY server/go.mod server/go.sum* ./
RUN go mod download

# Layer 2: application source (changes on every code edit)
COPY server/ ./

RUN CGO_ENABLED=1 GOOS=linux \
    go build -buildmode=pie -o /out/mpod ./cmd/mpod

# Final image
FROM alpine:3.24.1
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
