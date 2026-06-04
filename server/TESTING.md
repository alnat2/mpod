# Server Testing

The Go backend uses standard Go modules from [go.mod](/Users/cross/Documents/mpod/server/go.mod:1) and [go.sum](/Users/cross/Documents/mpod/server/go.sum:1). Tests do not rely on a committed `vendor/` tree.

## Run tests

```bash
cd server
go test ./...
```

If you are running in a restricted environment that blocks Go's default build cache location, redirect `GOCACHE` into `/tmp`:

```bash
cd server
GOCACHE=/tmp/mpod-go-build-cache go test ./...
```

## Refresh module dependencies

When dependencies change, refresh module metadata on a machine with network access:

```bash
cd server
go mod tidy
```

## Notes

- `go test` uses module resolution from `go.mod` and `go.sum`.
- `GOMODCACHE` is not required for normal test runs, but first-run dependency download still needs network access.
- `go mod tidy` requires network access when adding or updating dependencies.
