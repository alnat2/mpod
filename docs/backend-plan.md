# Backend Plan

## Chosen Stack

- Language: Go
- HTTP: standard library `net/http` with `ServeMux`
- Database: SQLite via `modernc.org/sqlite`
- Password hashing: `golang.org/x/crypto/bcrypt`
- Feed parsing: `github.com/mmcdole/gofeed`
- SOCKS5 support: `golang.org/x/net/proxy`
- Migrations: custom SQL migration runner
- Sessions: custom server-side SQLite-backed sessions

## Why These Choices

- `net/http` is enough for the current API and avoids a routing dependency too early.
- `modernc.org/sqlite` keeps SQLite support pure Go, which simplifies builds and Docker.
- `bcrypt` is the straightforward password hashing choice for a simple auth system.
- `gofeed` handles real-world RSS/Atom parsing better than writing custom XML parsing from scratch.
- `x/net/proxy` gives us the SOCKS5 support required by the product docs.
- A custom migration runner keeps schema control explicit and simple.
- Custom server-side sessions fit the product decision doc without extra framework glue.

## Scaffolded Now

- `server/go.mod`
- `server/cmd/mpod/main.go`
- `server/internal/app/`
- `server/internal/http/`
- `server/internal/storage/`
- `server/migrations/0001_initial.sql`

## Immediate Next Steps

1. run `go mod tidy`
2. implement auth and session storage
3. implement settings storage and session check helpers
4. implement podcast add/list flow
5. implement feed import and deduplication
6. implement playlist, playback, and downloads
7. add scheduler

## Notes

- The current HTTP routes are intentionally scaffolded, not feature-complete.
- The first migration already includes the schema additions approved in the planning docs.
- The startup path already runs migrations and reconciles missing downloaded files.
