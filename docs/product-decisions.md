# mpod - Product Decisions

This document captures implementation decisions that refine the product requirements in [prd.md](/Users/cross/Documents/mpod/prd.md). These decisions are intended to remove ambiguity before implementation starts.

## Auth Bootstrap

### Decision
mpod is a single-user personal application with no public multi-user registration. The only user is created through a one-time initial registration flow when the application starts with an empty database.

### Rules
- The application is allowed to start with an empty `users` table.
- If the `users` table is empty, the app must show an initial registration screen instead of the login screen.
- The first successful registration creates the only user in the system.
- After the first user is created, registration is permanently disabled.
- All future authentication uses username/password login with session-based authentication.
- No second user can be created through the UI or API.
- Passwords are stored only as hashes, never in plain text.

### First-Run Behavior
- On first launch, if no user exists, the app opens in setup mode.
- Setup mode contains a single registration form:
  - `username`
  - `password`
- After successful registration:
  - the user record is created
  - the password is hashed before storage
  - the user is logged in immediately
  - the app redirects to the main application

### Later Behavior
- If a user already exists, the initial registration screen must not be accessible.
- In that case, the app shows the normal login screen.
- Any attempt to call the registration endpoint after first setup must return an error.

### API Behavior
- A one-time registration endpoint may exist only for initial setup.
- If no user exists, registration is allowed.
- If a user already exists, the endpoint must reject the request.

### Notes
- This matches the product goal of a simple local personal app.
- It keeps the auth model simple: one setup flow, then normal login only.

## API Shape

### Decision
mpod uses a small JSON REST API under `/api` with session-based authentication. The API is intentionally minimal and unpaginated for MVP.

### Rules
- Base path is `/api`
- Request and response format is JSON, except file upload/download cases
- Authentication uses a session cookie
- Protected endpoints return `401 Unauthorized` if the user is not logged in
- Validation errors return `400 Bad Request`
- Missing resources return `404 Not Found`
- Server errors return `500 Internal Server Error`
- Error responses use one consistent structure

### Error Format
```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Username or password is incorrect"
  }
}
```

### Auth Endpoints

#### `POST /api/auth/register`
Used only during first-run setup.

Request:
```json
{
  "username": "admin",
  "password": "secret"
}
```

Success response:
```json
{
  "user": {
    "id": 1,
    "username": "admin"
  }
}
```

Rules:
- Allowed only if no user exists
- Creates the only user
- Starts a logged-in session immediately
- Returns error if a user already exists

#### `POST /api/auth/login`

Request:
```json
{
  "username": "admin",
  "password": "secret"
}
```

Success response:
```json
{
  "user": {
    "id": 1,
    "username": "admin"
  }
}
```

#### `POST /api/auth/logout`

Success response:
```json
{
  "success": true
}
```

#### `GET /api/auth/session`

Success response:
```json
{
  "authenticated": true,
  "user": {
    "id": 1,
    "username": "admin"
  },
  "setupRequired": false
}
```

If no user exists yet:
```json
{
  "authenticated": false,
  "user": null,
  "setupRequired": true
}
```

### Podcast Endpoints

#### `GET /api/podcasts`

Response:
```json
{
  "podcasts": [
    {
      "id": 12,
      "title": "Example Podcast",
      "rssUrl": "https://example.com/feed.xml",
      "lastChecked": "2026-04-21T08:00:00Z",
      "updateTime": null
    }
  ]
}
```

#### `POST /api/podcasts`

Request:
```json
{
  "rssUrl": "https://example.com/feed.xml"
}
```

Response:
```json
{
  "podcast": {
    "id": 12,
    "title": "Example Podcast",
    "rssUrl": "https://example.com/feed.xml",
    "lastChecked": null,
    "updateTime": null
  }
}
```

Rules:
- Server fetches and parses the feed before creating the podcast
- If the feed is invalid or unreachable, return an error
- Duplicate subscriptions must be rejected

#### `GET /api/podcasts/:id`

Response:
```json
{
  "podcast": {
    "id": 12,
    "title": "Example Podcast",
    "rssUrl": "https://example.com/feed.xml",
    "lastChecked": "2026-04-21T08:00:00Z",
    "updateTime": null
  }
}
```

#### `DELETE /api/podcasts/:id`

Success response:
```json
{
  "success": true
}
```

Rules:
- Deletes the podcast subscription
- Does not delete episodes from other podcasts
- Exact episode/file deletion policy should follow file lifecycle rules

#### `POST /api/podcasts/:id/refresh`

Success response:
```json
{
  "success": true,
  "newEpisodes": 3,
  "lastChecked": "2026-04-21T08:00:00Z"
}
```

#### `POST /api/podcasts/import-opml`
Request is `multipart/form-data` with one OPML file.

Response:
```json
{
  "success": true,
  "imported": 8,
  "skipped": 2
}
```

#### `GET /api/podcasts/export-opml`
Response is an OPML file download.

### Episode Endpoints

#### `GET /api/podcasts/:id/episodes`

Response:
```json
{
  "episodes": [
    {
      "id": 55,
      "podcastId": 12,
      "title": "Episode 1",
      "audioUrl": "https://cdn.example.com/ep1.mp3",
      "duration": 2400,
      "downloaded": true,
      "isListened": false,
      "publishedAt": "2026-04-20T10:00:00Z"
    }
  ]
}
```

#### `GET /api/episodes/:id`

Response:
```json
{
  "episode": {
    "id": 55,
    "podcastId": 12,
    "title": "Episode 1",
    "audioUrl": "https://cdn.example.com/ep1.mp3",
    "duration": 2400,
    "downloaded": true,
    "isListened": false,
    "publishedAt": "2026-04-20T10:00:00Z"
  }
}
```

#### `POST /api/episodes/:id/download`

Success response:
```json
{
  "success": true,
  "episode": {
    "id": 55,
    "downloaded": true
  }
}
```

#### `DELETE /api/episodes/:id/download`

Success response:
```json
{
  "success": true,
  "episode": {
    "id": 55,
    "downloaded": false
  }
}
```

#### `PATCH /api/episodes/:id`

Request example:
```json
{
  "isListened": true
}
```

Success response:
```json
{
  "episode": {
    "id": 55,
    "isListened": true
  }
}
```

Rules:
- `PATCH /api/episodes/:id` is used only for simple state changes such as listened/unlistened
- If marking listened triggers file deletion by default, that behavior belongs to file lifecycle rules
- Marking unlistened does not restore a file that was already deleted by a committed action

### Playlist Endpoints

#### `GET /api/playlist`

Response:
```json
{
  "items": [
    {
      "episodeId": 55,
      "position": 1,
      "episode": {
        "id": 55,
        "title": "Episode 1",
        "podcastId": 12,
        "isListened": false,
        "downloaded": true
      }
    }
  ]
}
```

#### `POST /api/playlist`

Request:
```json
{
  "episodeId": 55
}
```

Success response:
```json
{
  "success": true
}
```

#### `DELETE /api/playlist/:episodeId`

Success response:
```json
{
  "success": true
}
```

Rules:
- If the episode is already in playlist, server should not add a duplicate entry
- Removing from playlist may trigger file deletion according to file lifecycle rules

#### `PATCH /api/playlist/reorder`

Request:
```json
{
  "episodeIds": [55, 89, 21]
}
```

Success response:
```json
{
  "success": true
}
```

Rules:
- Request must contain the full final playlist order
- Any missing or unknown episode ID should return an error

### Playback Endpoints

#### `GET /api/playback/:episodeId`

Response:
```json
{
  "playback": {
    "episodeId": 55,
    "positionSeconds": 812,
    "lastUpdated": "2026-04-21T10:15:00Z"
  }
}
```

#### `POST /api/playback`

Request:
```json
{
  "episodeId": 55,
  "positionSeconds": 812,
  "durationSeconds": 2400,
  "completed": false,
  "didSeek": false,
  "clientUpdatedAt": "2026-04-21T10:15:00Z"
}
```

Success response:
```json
{
  "playback": {
    "episodeId": 55,
    "positionSeconds": 812,
    "lastUpdated": "2026-04-21T10:15:01Z"
  }
}
```

Rules:
- Conflict resolution rules belong to the playback sync section
- If playback completion marks the episode listened, that behavior must be applied here

### Settings Endpoints

#### `GET /api/settings`

Response:
```json
{
  "settings": {
    "dailyRefreshTime": "03:00",
    "proxyEnabled": true,
    "proxyConfigured": true
  }
}
```

#### `PATCH /api/settings`

Request:
```json
{
  "dailyRefreshTime": "03:00",
  "proxyEnabled": true
}
```

Response:
```json
{
  "settings": {
    "dailyRefreshTime": "03:00",
    "proxyEnabled": true,
    "proxyConfigured": true
  }
}
```

Rules:
- `proxyConfigured` is read-only and comes from runtime SOCKS5 environment configuration.
- `proxyEnabled` is user-editable and persisted in database-backed settings.
- If proxy configuration is incomplete or unavailable, `proxyConfigured` is `false` and the UI should not allow enabling proxy usage.
- Host, port, username, and password remain environment configuration and must not be edited from the UI for MVP.

### System Endpoints

#### `GET /api/health`

Response:
```json
{
  "ok": true
}
```

#### `GET /api/jobs/status`

Response:
```json
{
  "scheduler": {
    "state": "idle",
    "lastRunAt": "2026-04-21T03:00:00Z",
    "lastSuccessAt": "2026-04-21T03:00:12Z"
  }
}
```

### Notes
- The API is intentionally small for MVP
- No pagination, search params, or advanced filtering are included
- State-changing rules such as sync conflicts, deletion behavior, and duplicate handling are defined in later decision sections

## Playback Sync Rules

### Decision
Playback position is stored per episode for the single user. The server keeps one current playback state for each episode and updates it using simple freshness and progress rules.

### Rules
- Playback state is stored per episode.
- Each episode has at most one playback record.
- The server is the final authority for stored playback state.
- Playback updates are accepted only for existing episodes.
- Playback state contains:
  - `episodeId`
  - `positionSeconds`
  - `lastUpdated`

### Update Endpoint Behavior
Playback is updated through `POST /api/playback`.

Request fields:
- `episodeId`
- `positionSeconds`
- `durationSeconds`
- `completed`
- `didSeek`
- `clientUpdatedAt`

### Completion Rules
- If `completed = true`, the episode is treated as finished immediately.
- If `positionSeconds >= durationSeconds - 15`, the episode is also treated as finished.
- When an episode is finished:
  - it is marked as listened
  - playback position is stored as full duration or final reported position
  - any file and playlist side effects follow file lifecycle rules

### Position Update Rules
- If no playback record exists yet, create one.
- If the new position is greater than the stored position, accept it.
- If the new position is lower than the stored position by less than 30 seconds, ignore it.
- If the new position is lower than the stored position by 30 seconds or more:
  - accept it only if `didSeek = true`
  - otherwise ignore it
- Negative positions are invalid and must be rejected.
- If `durationSeconds` is present and `positionSeconds > durationSeconds`, clamp the stored value to `durationSeconds`.

### Freshness Rules
- If `clientUpdatedAt` is older than the stored `lastUpdated`, ignore the update.
- If `clientUpdatedAt` is missing, the server may still accept the update and use server time as `lastUpdated`.
- Stored `lastUpdated` is always written using server time.

### Returned State
After an accepted update, the API returns the stored playback state:
- `episodeId`
- `positionSeconds`
- `lastUpdated`

If an update is ignored because it is stale or invalid for sync purposes, the API should still return the current stored playback state instead of failing.

### Read Behavior
`GET /api/playback/:episodeId` returns:
- current playback state if it exists
- `null` playback if no state exists yet

Example:
```json
{
  "playback": null
}
```

### Notes
- This keeps sync simple for a personal multi-device app.
- Forward progress is preferred over accidental regressions.
- Small backward jumps are treated as noise unless they are explicit seeks.
- Completion always wins over partial progress.

## File Lifecycle

### Decision
Downloaded episode files are temporary local copies. By default, removing an episode from the playlist deletes its downloaded file, and marking an episode as listened deletes its downloaded file.
For manual UI actions that offer undo, the app keeps the downloaded file during the undo window and applies the file-deleting change only after the undo window expires.

### Rules
- Downloaded files are stored on local disk.
- Each downloaded episode has at most one local file.
- The database stores the local file path in `downloaded_path`.
- If `downloaded_path` is set, the app treats the episode as downloaded.
- If the file is missing on disk, the app must clear `downloaded_path` when the mismatch is detected.

### Storage Layout
- Base data directory contains all persistent app data.
- Downloaded audio files are stored under a downloads directory inside the data directory.
- Recommended path pattern:
  - `/data/downloads/<podcast-id>/<episode-id>-<safe-filename>`

### Download Rules
- `POST /api/episodes/:id/download` downloads the audio file for the episode.
- If a valid local file already exists, the app should not download it again.
- If a file is missing or invalid, the app may redownload it.
- Filenames must be sanitized before writing to disk.
- Remote filenames must not be trusted directly.

### Deletion Rules
- `DELETE /api/episodes/:id/download` deletes the local file if it exists and clears `downloaded_path`.
- `DELETE /api/playlist/:episodeId` deletes the local file by default and clears `downloaded_path`.
- `PATCH /api/episodes/:id` with `isListened = true` deletes the local file by default and clears `downloaded_path`.
- If there is no local file, these actions still succeed as state updates.

### Undo Window For Manual UI Actions
- Manual UI actions that expose `Undo` should keep the previous backend/file state during the 15-second undo window.
- During the undo window, the UI may show a pending listened or pending removed state, but the downloaded file remains saved and `downloaded_path` remains valid.
- If the user clicks `Undo`, cancel the pending action; the episode returns to its previous state and remains downloaded if it was downloaded before the action.
- If the undo window expires, commit the action and apply the normal file lifecycle rule.
- The simplest MVP implementation is to keep the action pending in the frontend and send the backend mutation only when the undo window expires.
- This pending undo rule applies to manual actions from the UI, not automatic playback completion.

### Marking Listened
- Marking an episode as listened updates `is_listened = true`.
- By default, marking listened also deletes the downloaded file.
- When manual mark-listened is shown with `Undo`, the downloaded file is deleted only after the 15-second undo window expires.
- If the user clicks `Undo` before the window expires, the episode remains unlistened and downloaded.
- Marking an episode as unlistened does not restore a file that was already deleted by a committed action.
- If playback completion marks an episode as listened, the same file deletion rule applies.
- A frontend `Mark all listened` action may mark all affected unlistened episodes for the selected podcast as listened.
- `Mark all listened` follows the same manual undo and file lifecycle rules as individual mark-listened actions.
- A separate bulk backend endpoint is not required for MVP; the frontend may keep the bulk action pending during the undo window and then commit individual mark-listened mutations after the window expires.

### Playlist Behavior
- Adding an episode to playlist does not download it automatically.
- Removing an episode from playlist deletes its local file by default.
- When manual remove-from-playlist is shown with `Undo`, the downloaded file is deleted only after the 15-second undo window expires.
- Removing an episode from playlist does not delete the episode database record.

### Podcast Deletion
- If a podcast is deleted, all downloaded files belonging to that podcast should be deleted.
- Episode records associated with that podcast should also be deleted if podcast deletion is treated as full subscription removal.
- Playlist entries and playback records for deleted episodes must also be removed.

### Failure Handling
- If file deletion fails, the API should return an error and leave database state unchanged where possible.
- If file deletion succeeds but database update fails, the app should correct the inconsistency on next startup or validation pass.
- The app should prefer keeping DB state aligned with actual disk state.

### Notes
- This makes storage usage self-cleaning for a personal app.
- It treats downloads as disposable playback files, not long-term archived media.
- Deleting files on playlist removal and listened state keeps disk usage low without extra cleanup settings.

## Scheduler Behavior

### Decision
mpod uses a single built-in scheduler in the backend process to refresh podcast feeds once per day at a user-defined time.

### Rules
- There is one global daily refresh time for the whole application.
- The scheduler runs inside the backend process.
- Only one scheduled refresh job may run at a time.
- Manual refresh remains available at any time.
- Scheduled refresh and manual refresh must not run in parallel for the same podcast.

### Timezone Rules
- The scheduler uses the application timezone.
- The application timezone is taken from the `TZ` environment variable.
- The user-defined refresh time is interpreted in that timezone.
- Stored timestamps may remain in UTC internally, but scheduled execution must follow `TZ`.

### Daily Run Rules
- The scheduler runs once per day at the configured refresh time.
- On successful completion, it updates scheduler job status and per-podcast `last_checked`.
- If the app is not running at the scheduled time, no retroactive run is required unless catch-up behavior is added later.
- Scheduler behavior should stay simple for MVP.

### Retry Policy
- If a feed refresh fails, the app retries up to 3 times.
- Retry timing:
  - 1st retry after 30 seconds
  - 2nd retry after 2 minutes
  - 3rd retry after 5 minutes
- If all retries fail, the podcast refresh is marked failed for that run.
- Failure of one podcast must not stop refresh of other podcasts.

### Duplicate Prevention
- Refresh must be idempotent.
- Running refresh multiple times must not create duplicate podcast subscriptions.
- Running refresh multiple times must not create duplicate episode records.
- Duplicate detection rules for episodes are defined in the RSS edge cases section.

### Overlap Rules
- If a scheduled refresh is already running, the next scheduled refresh must not start another concurrent job.
- If a manual refresh is requested while scheduled refresh is running:
  - either reject it with a clear error
  - or queue it after current job completes
- For MVP, rejecting overlapping manual refresh is simpler.

### Status Tracking
The app should track scheduler state for UI/API visibility.

Global scheduler/job state:
- `idle`
- `running`
- `completed`
- `failed`

Suggested tracked fields:
- `lastRunAt`
- `lastSuccessAt`
- `lastFailureAt`
- `lastError`

Per podcast:
- `last_checked`
- optional `last_error`

### Manual Refresh Behavior
- Manual refresh may target one podcast or all podcasts, depending on endpoint used.
- Manual refresh uses the same fetch and deduplication logic as scheduled refresh.
- Manual refresh updates the same status fields as scheduled refresh where relevant.

### Notes
- One global schedule is enough for a personal app MVP.
- No per-podcast scheduling is needed.
- No missed-run catch-up logic keeps the scheduler simpler and easier to reason about.
- Retry logic is limited and predictable.

## RSS Edge Cases

### Decision
RSS import and refresh must be tolerant of imperfect real-world feeds. A bad or inconsistent feed must fail only its own operation and must not break the rest of the application.

### Rules
- Feed parsing errors affect only the current feed being processed.
- A malformed feed must not stop refresh of other podcasts.
- Episode insertion must be idempotent.
- The app must skip unusable episode entries instead of crashing the refresh process.

### Feed Validation
- If the RSS or Atom document cannot be fetched, return a feed fetch error.
- If the response is fetched but cannot be parsed, return a feed parse error.
- If the feed has no usable title, the app may use the feed URL or hostname as a fallback display title.
- If the feed later provides a better title, the title may be updated.

### Episode Identity Rules
Episode identity must be stable enough to prevent duplicates across repeated refreshes.

Identity priority:
1. `guid`, if present and non-empty
2. audio enclosure URL
3. fallback derived key from podcast + title + published date

Derived fallback key should use:
- `podcast_id`
- normalized title
- published timestamp if available

### Duplicate Prevention
- The app must not create duplicate episode rows for the same episode identity.
- Duplicate checks happen during:
  - feed refresh
  - manual refresh
  - OPML-import-triggered initial fetch
- If the same episode is found again, the app should update existing metadata instead of inserting a duplicate row.
- The app should persist a computed `external_episode_key` for each episode.
- The database should enforce uniqueness on `(podcast_id, external_episode_key)`.

### Mutable Metadata Updates
If an episode already exists, the app may update fields when better data appears later, such as:
- title
- description
- duration
- publication date
- audio URL if the feed changed it

The app should not overwrite local user state such as:
- `is_listened`
- playlist membership
- playback progress

### Missing GUID
- Empty GUID is treated as missing GUID.
- If GUID is missing, use audio enclosure URL as the next identity key.
- If both GUID and enclosure URL are missing, use fallback derived identity.
- If no reliable identity can be formed, skip the episode.

### Missing Audio
- If an entry has no playable audio enclosure URL, skip it.
- The app should not create an episode row for entries that cannot be played or downloaded.

### Missing Published Date
- If published date is missing, the episode may still be imported.
- In that case, duplicate fallback identity must rely on the remaining available fields.
- Missing published date should not block episode import if a stronger identity exists.

### URL Handling
- Feed URLs should be normalized before duplicate comparison where practical.
- Redirected feed fetches may be followed.
- The app may store the originally entered RSS URL or the final resolved URL, but duplicate subscription checks should avoid treating trivial URL variations as separate feeds.

### OPML Import Duplicates
- OPML import must not create duplicate podcast subscriptions.
- Duplicate subscriptions should be detected by normalized RSS URL.
- If the same feed appears multiple times in the OPML file, it should be imported only once.
- OPML import should trigger immediate feed fetch for newly added subscriptions.

### Feed Disappearance
- If an episode disappears from the feed later, the app must not delete the stored episode automatically.
- Feed refresh only adds new episodes and updates existing known episodes.
- It does not remove historical episode data by feed omission.

### Failure Handling
- A failed feed refresh should record an error for that podcast.
- The app should continue processing remaining podcasts.
- Parsing or validation failures should produce loggable, understandable error messages.

### Notes
- Real podcast feeds are often inconsistent.
- The app should prefer resilient import over strict rejection.
- Stable identity and duplicate prevention are more important than perfectly preserving all feed quirks.

## Docker / Runtime Defaults

### Decision
mpod runs as a single container application with local persistent storage. Runtime behavior is configured through environment variables with simple defaults suitable for personal self-hosting.

### Rules
- The application runs as one service.
- The application listens on port `5050`.
- Persistent application data is stored under a single data directory.
- SQLite is the only database for MVP.
- Logs are written to standard output.

### Network Defaults
- Internal application port: `5050`
- Default container port: `5050`
- Default published host port: `5050`

### Storage Defaults
- Base data directory: `/data`
- SQLite database path: `/data/mpod.sqlite`
- Download directory: `/data/downloads`

### Persistent Volumes
The container should mount one persistent volume for:
- database file
- downloaded episode files
- any future lightweight app state stored under `/data`

Recommended Docker volume mount:
- host or named volume -> `/data`

### Environment Variables

Required:
- `PORT=5050`
- `DATA_DIR=/data`
- `DB_PATH=/data/mpod.sqlite`
- `DOWNLOADS_DIR=/data/downloads`
- `SESSION_SECRET=change-me`
- `TZ=UTC`

Optional:
- `DAILY_REFRESH_TIME=03:00`
- `SOCKS5_HOST`
- `SOCKS5_PORT`
- `SOCKS5_USERNAME`
- `SOCKS5_PASSWORD`

### Session Defaults
- Authentication uses secure server-side sessions.
- Session secret comes from `SESSION_SECRET`.
- Cookie behavior may vary by environment, but production should use secure cookie settings where possible.
- Runtime must fail clearly if `SESSION_SECRET` is missing.

### Proxy Behavior
- SOCKS5 proxy configuration is optional.
- If proxy variables are provided and proxy usage is enabled in Settings, they are used for:
  - RSS feed fetching
  - episode streaming
  - episode downloads
- If proxy variables are not provided, or if proxy usage is disabled in Settings, network requests use direct connection.
- The Settings screen must provide a proxy on/off switch when proxy configuration is available.
- The proxy switch controls whether configured proxy settings are used; it does not edit proxy host, port, username, or password.
- Partial proxy configuration should be treated as invalid if required proxy host/port values are incomplete.

### Timezone Behavior
- Runtime timezone is controlled by `TZ`.
- Scheduler interprets `DAILY_REFRESH_TIME` using `TZ`.
- Stored timestamps may still use UTC internally.

### Docker Compose Vision
Recommended Compose setup:
- one service: `mpod`
- one persistent volume: `mpod_data`
- restart policy enabled
- environment variables defined directly or via `.env`
- port mapping `5050:5050`

### Example Runtime Shape
```yaml
services:
  mpod:
    build: .
    ports:
      - "5050:5050"
    environment:
      PORT: 5050
      TZ: UTC
      SESSION_SECRET: change-me
      DATA_DIR: /data
      DB_PATH: /data/mpod.sqlite
      DOWNLOADS_DIR: /data/downloads
      DAILY_REFRESH_TIME: "03:00"
    volumes:
      - mpod_data:/data
    restart: unless-stopped

volumes:
  mpod_data:
```

### Notes
- This keeps deployment small and predictable.
- No separate database container is needed.
- One mounted data directory is enough for the MVP.

## Data Model Additions

### Decision
The initial schema should include a few fields and tables beyond the PRD so the implementation can support deduplication, richer podcast metadata, and scheduler/settings state cleanly.

### Required Additions
- `episodes.external_episode_key`
- `episodes.description`
- `podcasts.description`
- `podcasts.image_url`
- `settings` table
- scheduler state persistence, either as a dedicated `scheduler_state` table or equivalent persisted fields

### Rules
- `episodes.external_episode_key` must be computed during import/refresh and used for duplicate prevention.
- `episodes.external_episode_key` must be unique per podcast.
- `episodes.description` stores feed-provided episode summary or description text when available.
- `podcasts.description` stores feed-level podcast description when available.
- `podcasts.image_url` stores feed artwork URL when available.
- `settings` must persist `daily_refresh_time`.
- `settings` must persist `proxy_enabled`.
- Scheduler state persistence must store enough information to expose:
  - `lastRunAt`
  - `lastSuccessAt`
  - `lastFailureAt`
  - `lastError`

### Notes
- These additions are implementation-enabling schema details, not scope expansion.
- They should be part of the first migration set rather than added ad hoc later.

## Project Initialization Rules

### Decision
The backend should start with explicit schema management and startup reconciliation behavior rather than relying on implicit database sync.

### Rules
- The project must use a real migration system from day one.
- Automatic ORM schema sync must not be used as the production schema mechanism.
- Schema versioning must be persisted in the database.
- Migrations should live under `server/src/db/migrations/`.
- On startup, the app should reconcile downloaded file state against the filesystem.

### Startup Reconciliation
- Query episodes with `downloaded_path` set.
- Verify the file exists on disk.
- If the file is missing, clear `downloaded_path`.
- Log mismatches for visibility.

### Notes
- This avoids stale DB state after manual file deletion, failed volume mounts, or partial write failures.
- Reconciliation should happen before normal request handling starts when possible.

## Podcast Deletion Behavior

### Decision
Deleting a podcast is a full subscription removal and cascades through its dependent data.

### Rules
- Deleting a podcast deletes that podcast record.
- Deleting a podcast deletes all episodes belonging to that podcast.
- Deleting a podcast deletes all downloaded files for those episodes.
- Deleting a podcast removes affected playlist entries.
- Deleting a podcast removes affected playback rows.

### Notes
- This keeps app state consistent and avoids orphaned playlist, playback, and file records.

## Session Secret Rules

### Decision
The app should reject unsafe session secret configuration in production.

### Rules
- `SESSION_SECRET` is always required.
- In production mode, the app must refuse to start if `SESSION_SECRET` is missing.
- In production mode, the app must refuse to start if `SESSION_SECRET` is a known placeholder such as `change-me`.

### Notes
- Local development may allow simpler secrets, but production startup should fail clearly on unsafe defaults.
