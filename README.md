# mpod

mpod is a personal self-hosted web app for managing podcasts. It is designed for a single user and focuses on a simple workflow: subscribe to podcasts, import feeds, download episodes, build a playlist, and resume playback across devices.

This repository is currently in the planning stage. The core product scope is defined in [prd.md](/Users/cross/Documents/mpod/prd.md), with implementation decisions in [docs/product-decisions.md](/Users/cross/Documents/mpod/docs/product-decisions.md) and system structure in [docs/architecture.md](/Users/cross/Documents/mpod/docs/architecture.md).

## Goals

- Simple personal podcast manager
- RSS and OPML import/export
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

## Product Scope

Planned MVP capabilities:
- one-time initial registration for the only user
- username/password login with session-based auth
- add podcast by RSS URL
- import subscriptions from OPML
- export subscriptions to OPML
- fetch and store podcast episodes
- download episode audio files
- add and remove episodes from a playlist
- reorder playlist
- play episodes with position tracking
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

## Planned Runtime Defaults

Current intended defaults:
- app port: `5050`
- base data directory: `/data`
- database path: `/data/mpod.sqlite`
- downloads path: `/data/downloads`
- one container, one persistent volume

Expected runtime configuration:
- `PORT`
- `TZ`
- `SESSION_SECRET`
- `DATA_DIR`
- `DB_PATH`
- `DOWNLOADS_DIR`
- `DAILY_REFRESH_TIME`
- `SOCKS5_HOST`
- `SOCKS5_PORT`
- `SOCKS5_USERNAME`
- `SOCKS5_PASSWORD`

## Repository Status

The backend MVP is implemented in Go and the frontend has not been scaffolded yet.

Current backend capabilities include:
- one-time registration and session-based auth
- podcast add/list/detail/delete/refresh
- RSS import on subscription
- OPML import/export
- episode listing and detail
- playlist add/remove/reorder
- episode download/delete
- playback sync endpoints
- daily refresh settings and scheduler status

The next expected additions are:
- frontend application scaffold
- UI implementation against the existing API
- broader tests and polish

## Development Approach

The project is being defined in this order:
1. product requirements
2. product decisions
3. architecture
4. starter project files
5. implementation

This should keep the first implementation pass simple and reduce rework.
