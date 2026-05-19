# Current Status

## Current State

mpod is a browser-based web application. The project has an active Go backend implementation in progress, and the frontend has not been scaffolded yet.

The starter documentation set is in place:
- [README.md](/Users/cross/Documents/mpod/README.md)
- [AGENTS.md](/Users/cross/Documents/mpod/AGENTS.md)
- [prd.md](/Users/cross/Documents/mpod/prd.md)
- [product-decisions.md](/Users/cross/Documents/mpod/docs/product-decisions.md)
- [architecture.md](/Users/cross/Documents/mpod/docs/architecture.md)
- [.env.example](/Users/cross/Documents/mpod/.env.example)
- [docker-compose.yml](/Users/cross/Documents/mpod/docker-compose.yml)
- [Dockerfile](/Users/cross/Documents/mpod/Dockerfile)

## Approved Decisions

- The app is single-user only.
- The only user is created through one-time initial registration on first run.
- Backend language is Go.
- Frontend remains React.
- Database is SQLite.
- App port is `5050`.
- Downloads are stored under `/data/downloads`.
- Removing an episode from playlist deletes its local file by default.
- Marking an episode as listened deletes its local file by default.
- Scheduler runs once per day at one global configured time.
- OPML import should trigger immediate feed fetch for newly added subscriptions.
- Podcast deletion should cascade through episodes, playback, playlist entries, and downloaded files.
- Episode deduplication should use persisted `external_episode_key`.
- The project should use real database migrations from day one.

## Current Focus

The backend MVP implementation is now in place. The main remaining project work has shifted to frontend implementation and UX/UI decisions.
Suggested project chat lanes for this phase are documented in [chat-map.md](/Users/cross/Documents/mpod/docs/chat-map.md).

User flows and UX/UI decisions are still an active planning area and may continue in parallel with backend work.

Current approved frontend direction:
- frontend implementation will use `shadcn/ui`
- Figma design work should use the Sitsiilia `shadcn ui components with variables` library as the primary base library

The Go backend scaffold is now in place with:
- app/config bootstrap
- SQLite open and migrations
- startup download reconciliation
- health endpoint
- session check endpoint
- initial registration, login, and logout endpoints
- SQLite-backed server-side sessions
- podcast list endpoint
- podcast creation from RSS feed with initial episode import
- OPML import with immediate fetch for new subscriptions
- OPML export for current subscriptions
- podcast detail, delete, and manual refresh
- podcast episode listing
- episode detail
- playlist list/add/remove/reorder
- episode download and download deletion
- playback get/update with sync conflict rules
- episode listened/unlistened patch endpoint
- shared outbound HTTP client with optional SOCKS5 support
- settings get/update for `daily_refresh_time`
- settings proxy on/off switch and proxy-configured status when SOCKS5 runtime configuration is available
- scheduler status endpoint
- daily scheduler wiring
- focused backend tests for playback sync and feed identity behavior

## Ready For Later

When implementation resumes, the next likely steps are:
1. define or refine user flows and UX/UI decisions
2. scaffold frontend
3. connect frontend to the existing backend API
4. add broader backend test coverage and polish where needed

## Open Topics

- user flows
- UX/UI behavior decisions
- screen structure and interaction patterns
