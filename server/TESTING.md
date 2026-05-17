# Server Testing

The Go backend vendors its module dependencies under [vendor/](/Users/cross/Documents/mpod/server/vendor:1), so tests do not need a first-run download from `proxy.golang.org`.

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

## Refresh vendored dependencies

When `go.mod` or `go.sum` changes, refresh the vendor tree on a machine with network access:

```bash
cd server
go mod tidy
go mod vendor
```

## Notes

- The committed `vendor/` tree is the source used by `go test` in this module by default.
- `GOMODCACHE` is no longer required for normal test runs.
- `go mod tidy` and `go mod vendor` still require network access when adding or updating dependencies.
