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
WORKDIR /src
COPY server/go.mod server/go.sum* ./server/
WORKDIR /src/server
RUN go mod download
COPY server/ /src/server/
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/mpod ./cmd/mpod

# Final image
FROM alpine:3.22
RUN adduser -D -h /app mpod
WORKDIR /app
COPY --from=frontend-builder /src/frontend/dist ./frontend/dist
COPY --from=backend-builder /out/mpod /usr/local/bin/mpod
USER mpod
EXPOSE 5050
CMD ["mpod"]
