# mpod

mpod is a personal self-hosted web app for managing podcasts. It is designed for a single user and focuses on a simple workflow: subscribe to podcasts, import feeds, download episodes, build a playlist, and resume playback across devices.
It is a browser-based application, not a CLI tool or a native desktop/mobile app.

This repository has a completed Go backend MVP and is now focused on frontend scaffold, UX/UI decisions, and integration. The core product scope is defined in [prd.md](/Users/cross/Documents/mpod/prd.md), with implementation decisions in [docs/product-decisions.md](/Users/cross/Documents/mpod/docs/product-decisions.md) and system structure in [docs/architecture.md](/Users/cross/Documents/mpod/docs/architecture.md).

## Goals

- Simple personal podcast and audiobook manager
- RSS and OPML import/export
- Local audiobooks library scanning with automatic inotify watching
- Episode downloading
- Playlist-based listening
- Cross-device playback resume
- Docker-based deployment
- SOCKS5 proxy support
- Minimal and fast interface

## Planned Stack

- Frontend: React
- Backend: Go
- Database: SQLite
- File storage: local filesystem
- Deployment: Docker Compose

## Application Shape

- Product type: browser-based web application
- Frontend: React SPA served by the backend
- Backend: Go HTTP API and static asset host
- API base path: `/api`

## Product Scope

Planned MVP capabilities:
- one-time initial registration for the only user
- username/password login with session-based auth
- add podcast by RSS URL
- import subscriptions from OPML
- export subscriptions to OPML
- fetch and store podcast episodes
- scan local audiobooks (.mp3, .m4b, .m4a) with automatic inotify watching
- download episode audio files
- add and remove episodes and audiobooks from a playlist
- reorder playlist
- play episodes and audiobook chapters with position tracking
- resume playback across devices
- daily scheduled feed refresh

Out of scope for MVP:
- multi-user support
- public registration
- OAuth or third-party auth
- external database
- cloud media storage

## Current Documentation

- Product requirements: [prd.md](/Users/cross/Documents/mpod/prd.md)
- Product decisions: [docs/product-decisions.md](/Users/cross/Documents/mpod/docs/product-decisions.md)
- Architecture: [docs/architecture.md](/Users/cross/Documents/mpod/docs/architecture.md)
- Suggested project chat lanes: [docs/chat-map.md](/Users/cross/Documents/mpod/docs/chat-map.md)

## Planned Runtime Defaults

Current intended defaults:
- app port: `5050`
- base data directory: `/data`
- database path: `/data/mpod.sqlite`
- downloads path: `/data/downloads`
- audiobooks path: `/data/audiobooks`
- one container, one persistent volume

Expected runtime configuration:
- `PORT`
- `TZ`
- `SESSION_SECRET`
- `DATA_DIR`
- `DB_PATH`
- `DOWNLOADS_DIR`
- `AUDIOBOOKS_DIR`
- `DAILY_REFRESH_TIME`
- `APP_ENV`
- `APP_BUILD`
- `SOCKS5_HOST`
- `SOCKS5_PORT`
- `SOCKS5_USERNAME`
- `SOCKS5_PASSWORD`

Deployment note:
- `APP_BUILD` should be set during deploy to the current short git commit hash so the Settings screen shows the real build identifier instead of `dev`.
- `.git` is excluded from the Docker build context, so the container cannot discover the commit hash by itself.
- Recommended deploy pattern:
  `APP_BUILD=$(git rev-parse --short HEAD) docker compose up -d --build`

Proxy host, port, username, and password remain runtime configuration. Default proxy runtime values are `SOCKS5_HOST=192.168.0.222` and `SOCKS5_PORT=1080`. When proxy configuration is available, the user can turn proxy usage on or off from Settings. When proxy usage is enabled, backend outbound network operations use the configured proxy path. When proxy usage is off, backend outbound network operations use direct network access. Authenticated playback streaming may make one direct retry if the proxied audio response fails or is not playable, because some podcast CDNs block specific proxy exits.

## Repository Status

The backend MVP is implemented in Go and the React frontend scaffold is now in place.

Current backend capabilities include:
- one-time registration and session-based auth
- podcast add/list/detail/delete/refresh/refresh-all
- RSS import on subscription
- OPML import/export
- episode listing and detail
- playlist add/remove/reorder
- episode download/delete and authenticated audio playback delivery
- playback sync endpoints
- daily refresh settings, proxy on/off settings, proxy runtime status, and scheduler status

Backend test/bootstrap notes:
- see [server/TESTING.md](/Users/cross/Documents/mpod/server/TESTING.md)

Frontend checks run from `frontend/`:
- `npm test` runs the Vitest suite
- `npm run test:coverage` prints coverage and writes HTML plus JSON summary reports to `frontend/coverage/`
- coverage is reported as a baseline without an arbitrary pass/fail threshold; bug fixes still require focused regression tests

The next expected additions are:
- continued frontend/backend integration polish
- broader end-to-end QA
- production packaging polish

## Development Approach

The project is being defined in this order:
1. product requirements
2. product decisions
3. architecture
4. starter project files
5. implementation

This should keep the first implementation pass simple and reduce rework.
