# Current Status

## Current State

mpod is a browser-based web application. The Go backend MVP is in place, and the React frontend scaffold is now connected to the existing API.

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
- podcast detail, delete, manual refresh, and refresh all
- podcast episode listing
- episode detail
- playlist list/add/remove/reorder
- episode download, download deletion, and authenticated audio playback delivery
- playback get/update with sync conflict rules
- episode listened/unlistened patch endpoint
- shared outbound HTTP client with optional SOCKS5 support; proxy enabled routes backend outbound network traffic through the proxy, proxy disabled uses direct network access, with a playback-streaming-only direct retry when a proxied audio response is failed or non-playable
- settings get/update for `daily_refresh_time`
- settings proxy on/off switch and proxy-configured status when SOCKS5 runtime configuration is available
- proxy runtime status endpoint for observed external IP/country when proxy usage is enabled
- scheduler status endpoint
- daily scheduler wiring
- focused backend tests for playback sync and feed identity behavior

## Ready For Later

When implementation resumes, the next likely steps are:
1. continue frontend/backend integration polish
2. verify critical user flows against real backend data
3. add broader end-to-end QA where needed
4. polish Docker/runtime packaging

## Open Topics

- user flows
- UX/UI behavior decisions
- screen structure and interaction patterns
