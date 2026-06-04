# Backend Implementation Notes

This document records the current backend implementation baseline.
It is not a forward-looking task plan. Product behavior remains governed by:

1. [product-decisions.md](product-decisions.md)
2. [architecture.md](architecture.md)
3. [../prd.md](../prd.md)

## Current Stack

- Language: Go
- HTTP: standard library `net/http` with `ServeMux`
- Database: SQLite via `github.com/mattn/go-sqlite3`
- Password hashing: `golang.org/x/crypto/bcrypt`
- Feed parsing: `github.com/mmcdole/gofeed`
- SOCKS5 support: `golang.org/x/net/proxy`
- Migrations: custom SQL migration runner
- Sessions: custom server-side SQLite-backed sessions

## Current Backend Shape

- Main entry point: `server/cmd/mpod/main.go`
- Internal packages live under `server/internal/`
- Database migrations live under `server/migrations/`
- Runtime data defaults to `/data`
- Downloaded files default to `/data/downloads`
- The app reconciles missing downloaded files on startup.

## Notes

- The backend is feature-complete enough for current MVP integration work.
- Do not use this file to introduce new product behavior.
- Update this file only when the implemented backend baseline changes.
