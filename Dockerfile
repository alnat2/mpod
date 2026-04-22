FROM golang:1.24-alpine AS builder

WORKDIR /src

COPY server/go.mod server/go.sum* ./server/
WORKDIR /src/server
RUN go mod download

COPY server/ /src/server/
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/mpod ./cmd/mpod

FROM alpine:3.22

RUN adduser -D -h /app mpod
WORKDIR /app

COPY --from=builder /out/mpod /usr/local/bin/mpod

USER mpod
EXPOSE 5050

CMD ["mpod"]
