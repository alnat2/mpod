# Server Testing

The Go backend uses external modules declared in [go.mod](/Users/cross/Documents/mpod/server/go.mod).

## First-time bootstrap

On a machine with network access, download modules first:

```bash
cd server
GOCACHE=/tmp/mpod-go-build-cache GOMODCACHE=/tmp/mpod-go-modcache go mod download
```

## Run tests

After modules are downloaded, run:

```bash
cd server
GOCACHE=/tmp/mpod-go-build-cache GOMODCACHE=/tmp/mpod-go-modcache go test ./...
```

## Notes

- Using `GOMODCACHE` is more practical than overriding all of `GOPATH`.
- A fresh cache on a machine without DNS/network access will fail to resolve modules from `proxy.golang.org`.
- If offline test execution becomes a regular requirement, vendoring dependencies is the next practical fallback.
