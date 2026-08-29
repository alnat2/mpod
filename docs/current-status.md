# Current Status

## Current State

mpod is a browser-based podcast and local-audiobook application. The Go backend and React frontend are connected, and audiobook library, playlist, and playback support are now part of the active product scope.

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
- Audiobooks are scanned from the read-only `/share/audio/abooks/` library by default.
- `Abooks` is a separate primary screen with nested collection navigation.
- A standalone audio file is one book; a folder with direct audio files is one book with naturally ordered chapters; a folder without direct audio files is a navigation level.
- A folder-backed book always occupies one playlist position, including when only selected chapters are included.
- A book leaves the playlist when its final selected chapter becomes listened; a later add starts the book over.
- Podcast and audiobook playback speeds are stored separately, defaulting to `Speed 1.3x` and `Speed 1x`.
- Audiobook source files are never deleted or modified by mpod.

## Current Focus

The podcast MVP baseline is in place. Current work is integrating and polishing the newer audiobook behavior across backend, frontend, API contracts, and UX documentation.
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
- playback get/update with sync conflict rules, explicit client-reported completion, and backend-selected completion fallback
- episode listened/unlistened patch endpoint
- shared outbound HTTP client with optional SOCKS5 support; proxy enabled routes backend outbound network traffic through the proxy, proxy disabled uses direct network access, with a playback-streaming-only direct retry when a proxied audio response is failed or non-playable
- settings get/update for `daily_refresh_time`
- settings proxy on/off switch and proxy-configured status when SOCKS5 runtime configuration is available
- proxy runtime status endpoint for observed external IP/country when proxy usage is enabled
- scheduler status endpoint
- daily scheduler wiring
- focused backend tests for playback sync and feed identity behavior
- audiobook directory scanning and rescan endpoints
- audiobook metadata, cover, chapter, and Range-enabled audio endpoints
- MP3 and M4A/M4B duration extraction during audiobook scans, before browser playback
- audiobook playlist operations for whole books and individual chapters
- one aggregated playlist item per audiobook, backed by explicit selected-chapter membership
- audiobook playback progress, active playback, selected-chapter transitions, and natural-completion cleanup
- reset of audiobook progress/listened state when the book leaves the playlist
- separate persisted podcast and audiobook playback speed preferences
- typed podcast/audiobook playback targets and queue identities, so equal numeric IDs cannot select the wrong media
- removal of the compatibility-only audiobook playlist column, exclusion table, and duplicate audiobook playback/delete endpoints

Current audiobook UI includes:
- separate `Abooks` navigation and library screen
- nested collection navigation with breadcrumbs
- whole-book and individual-chapter playlist controls
- library chapter-selection modal/bottom sheet with chapter duration and add/remove-from-playlist actions
- Player chapters modal/bottom sheet states for completed/replay, current playing, current paused, and upcoming chapters
- mixed podcast/audiobook Player queue
- content-specific Player actions: `Show notes` for podcasts, `Show chapters` for folder-backed audiobooks, and neither action for standalone audiobook files
- current-time `Go to time` input with hours and minutes
- audiobook player controls with `Speed 1x` default

## Ready For Later

When implementation resumes, the next likely steps are:
1. continue frontend/backend integration polish
2. verify critical podcast and audiobook flows against real backend data
3. compare the integrated UI with the approved Figma frames
4. add broader end-to-end QA for library rescans and mixed-media queue transitions
5. polish Docker/runtime packaging

## Open Topics

- malformed audiobook directory layouts outside the supported structure
- broader end-to-end coverage for library rescans and mixed-media queue transitions
