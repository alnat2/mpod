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

#### `POST /api/podcasts/refresh-all`

Accepted response:
```json
{
  "success": true,
  "state": "running"
}
```

Rules:
- Starts a background refresh for all subscribed podcasts using the same logic as per-podcast refresh and scheduled refresh
- The request returns after the refresh job is accepted; clients should use `GET /api/jobs/status` to observe completion or failure
- Failure of one podcast must not stop refresh attempts for other podcasts
- If a refresh for the same podcast is already running, the request should be rejected for MVP

#### `POST /api/podcasts/:id/mark-all-listened`

Marks every episode for one podcast as listened in one backend-owned operation.

Success response:
```json
{
  "success": true,
  "markedEpisodes": 12
}
```

Rules:
- Requires authentication.
- Returns `404 PODCAST_NOT_FOUND` if the podcast does not exist.
- Marks all podcast episodes listened in one DB transaction.
- Removes affected podcast episodes from the playlist.
- Clears `activePlayback` if the active episode belongs to that podcast.
- Applies the same downloaded-file cleanup rule used when marking an episode listened.
- Repeating the request is safe; already-listened episodes are not counted again.
- `markedEpisodes` is the number of episodes changed from unlistened to listened.

#### `POST /api/podcasts/import-opml`
Request is `multipart/form-data` with one OPML file.

The uploaded OPML file must be at most `5,000,000` bytes. Larger files return `413 Request Entity Too Large` with error code `OPML_TOO_LARGE`.

An OPML file may contain at most `1,000` unique normalized feed URLs. Files above that limit return `400 Bad Request` with error code `OPML_TOO_MANY_FEEDS` before any feed is fetched. Only one OPML import may run at a time; a concurrent request returns `409 Conflict` with error code `OPML_IMPORT_ALREADY_RUNNING`.

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

This authenticated endpoint remains available for backward compatibility and
administrative use. Normal clients do not need to call it: Smart Listening
automatically schedules a download 15 seconds after an episode is added to the
playlist.

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

#### `GET /api/episodes/:id/audio`

Response:
- If a valid local download exists, serves the downloaded audio file
- If no local download exists, proxies the episode's remote `audioUrl` through the authenticated backend endpoint
- If proxy usage is enabled and the proxied audio response is not loadable/playable, the backend may make one direct-network retry for playback streaming only

Rules:
- The endpoint requires authentication
- The endpoint is for playback only; it does not mark the episode as downloaded
- Range requests for remote audio should be forwarded so browser media controls can seek
- Direct retry is a resilience fallback for podcast/CDN compatibility; it must not change RSS fetching, OPML import, refresh, download, artwork, or proxy-status network behavior
- Missing episodes return `404 Not Found`

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
- Adding an episode to playlist marks it unlistened if it was listened
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

#### `GET /api/playback/queue`

Response:
```json
{
  "queue": [
    {
      "id": 55,
      "podcastId": 12,
      "title": "Episode",
      "podcastTitle": "Podcast",
      "playback": {
        "episodeId": 55,
        "positionSeconds": 812,
        "lastUpdated": "2026-07-14T11:58:00Z"
      }
    }
  ],
  "activePlayback": {
    "episodeId": 55,
    "lastUpdated": "2026-07-14T12:00:00Z"
  }
}
```

If no active episode has been selected, `activePlayback` is `null`.

#### `PUT /api/playback/active`

Request:
```json
{
  "episodeId": 55
}
```

Success response:
```json
{
  "activePlayback": {
    "episodeId": 55,
    "lastUpdated": "2026-07-14T12:00:00Z"
  }
}
```

Rules:
- Requires authentication.
- Returns `404 EPISODE_NOT_FOUND` when the episode does not exist.
- Returns `400 EPISODE_NOT_IN_PLAYLIST` when the episode is not in the playlist.
- Repeating the same episode ID is successful and refreshes `lastUpdated`.
- `lastUpdated` is written using server time.
- This endpoint is for explicit playback starts only; progress sync, pause, and seek updates must not call it.

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
  },
  "nextEpisodeId": null
}
```

Rules:
- Conflict resolution rules belong to the playback sync section
- Clients must set `completed = true` only after the audio engine reports actual completion.
- Near-end or full-duration progress with `completed = false` only updates position and must not trigger listened, playlist, or file side effects.
- If explicit playback completion marks the episode listened, that behavior must be applied here
- `nextEpisodeId` is backend-owned playback guidance for what to play next after a completion update
- For non-completion updates, `nextEpisodeId` is `null`
- When `nextEpisodeId` identifies an episode with no playback record, clients start it from `0:00`.

### Settings Endpoints

#### `GET /api/settings`

Response:
```json
{
  "settings": {
    "dailyRefreshTime": "03:00",
    "playbackSpeed": "Speed 1.3x",
    "proxyEnabled": true,
    "proxyConfigured": true,
    "appBuild": "dev"
  }
}
```

#### `PATCH /api/settings`

Request:
```json
{
  "dailyRefreshTime": "03:00",
  "playbackSpeed": "Speed 2x",
  "proxyEnabled": true
}
```

Response:
```json
{
  "settings": {
    "dailyRefreshTime": "03:00",
    "playbackSpeed": "Speed 2x",
    "proxyEnabled": true,
    "proxyConfigured": true,
    "appBuild": "dev"
  }
}
```

Rules:
- `playbackSpeed` is backend-owned user playback preference used for cross-device consistency.
- If no playback speed has been stored yet, backend returns `Speed 1.3x`.
- Supported labels are exactly:
  - `Speed 0.5x`
  - `Speed 0.75x`
  - `Speed 1x`
  - `Speed 1.3x`
  - `Speed 1.5x`
  - `Speed 2x`
- Unsupported playback speed labels must be rejected with `400 Bad Request`.
- `proxyConfigured` is read-only and comes from runtime SOCKS5 environment configuration.
- `proxyEnabled` is user-editable and persisted in database-backed settings.
- If proxy configuration is incomplete or unavailable, `proxyConfigured` is `false` and the UI should not allow enabling proxy usage.
- Host, port, username, and password remain environment configuration and must not be edited from the UI for MVP.
- `appBuild` is an optional read-only identifier for the current build (e.g. git hash), sourced from the `APP_BUILD` environment variable. If not provided, it defaults to `dev`.

#### `GET /api/proxy/status`

Response when proxy is disabled:
```json
{
  "proxy": {
    "proxyEnabled": false,
    "proxyConfigured": true,
    "status": "off",
    "externalIp": null,
    "country": null,
    "error": null
  }
}
```

Response when proxy is enabled and lookup succeeds:
```json
{
  "proxy": {
    "proxyEnabled": true,
    "proxyConfigured": true,
    "status": "ok",
    "externalIp": "203.0.113.10",
    "country": "Germany",
    "error": null
  }
}
```

Response when proxy is enabled but runtime lookup cannot confirm identity:
```json
{
  "proxy": {
    "proxyEnabled": true,
    "proxyConfigured": true,
    "status": "error",
    "externalIp": null,
    "country": null,
    "error": "request proxy status: lookup failed"
  }
}
```

Rules:
- This endpoint is for live runtime proxy identity, not persisted settings.
- `status` values for MVP are `off`, `ok`, `unknown`, and `error`.
- When proxy usage is disabled, frontend must treat the proxy as off and must not display stale observed IP/country as active proxy identity.
- When proxy usage is enabled, backend should attempt to resolve the current observed external IP and country using the current runtime networking path.
- If lookup fails, backend should still return a structured payload with `status` and `error` so frontend can render an explicit unknown/error state without inventing values.
- Proxy host, port, username, and password must never be returned by this endpoint.

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
    "timezone": "Europe/Moscow",
    "lastTrigger": "scheduled",
    "lastRunAt": "2026-04-21T03:00:00Z",
    "lastSuccessAt": "2026-04-21T03:00:12Z"
  }
}
```

Rules:
- this status represents the most recent global feed refresh run
- both the daily scheduled refresh and manual `Refresh all` update the same status
- `timezone` reflects the application timezone used to interpret `dailyRefreshTime`
- `lastTrigger` identifies whether the most recent run was `scheduled` or `manual`
- `lastRunAt`, `lastSuccessAt`, and `lastFailureAt` are returned as UTC timestamps in RFC3339 format

### Notes
- The API is intentionally small for MVP
- No pagination, search params, or advanced filtering are included
- State-changing rules such as sync conflicts, deletion behavior, and duplicate handling are defined in later decision sections

## Playback Sync Rules

### Decision
Playback position is stored per episode for the single user. The server keeps one current playback state for each episode and updates it using simple freshness and progress rules.
Playback speed selection should also be treated as backend-owned user playback state for cross-device consistency.

### Rules
- Playback state is stored per episode.
- Active playback state stores the single episode the user explicitly started most recently.
- Each episode has at most one playback record.
- The server is the final authority for stored playback state.
- Playback updates are accepted only for existing episodes.
- Active playback can only point to an existing episode that is currently in the playlist.
- Active playback changes only through `PUT /api/playback/active`.
- `POST /api/playback` position updates, pause, and seek do not change active playback.
- The last processed explicit active playback update wins across devices.
- Reading active playback must not automatically start playback.
- Playback speed selection should be stored as user playback state on the backend, not only in the frontend.
- If no playback speed has been selected yet, the default speed is `Speed 1.3x`.
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

Active playback is updated through `PUT /api/playback/active`.

Active playback request fields:
- `episodeId`

### Completion Rules
- If `completed = true`, the episode is treated as finished immediately.
- Clients send `completed = true` only in response to actual audio completion, not from a position threshold.
- Progress position alone must not mark an episode finished. Near-end playback progress is stored as progress only unless the client explicitly sends `completed = true`.
- When an episode is finished:
  - it is marked as listened
  - playback position is stored as full duration or final reported position
  - any file and playlist side effects follow file lifecycle rules
- Before removing the finished episode from the playlist, the backend checks whether it was the last item in the pre-removal playlist order.
- If the finished episode was the last playlist item, the backend looks at earlier playlist items and selects the topmost eligible fallback episode in playlist order.
- An eligible fallback episode must:
  - still be in the playlist after the finished episode cleanup
  - be unlistened
- The selected fallback episode may have no playback record yet; in that case clients should start it from `0:00`.
- If no eligible earlier episode exists, the backend returns `nextEpisodeId = null`.
- The selected fallback episode must not be marked listened, removed, reordered, or have its files changed as part of the finished episode cleanup.

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
- For ordinary progress and seek updates, if `clientUpdatedAt` is older than the stored `lastUpdated`, ignore the update.
- An explicit `completed = true` update must still be processed even when its `clientUpdatedAt` is older than the server-written `lastUpdated` from the immediately preceding progress sync. Completion is an audio-engine event, not a competing position update.
- If `clientUpdatedAt` is missing, the server may still accept the update and use server time as `lastUpdated`.
- Stored `lastUpdated` is always written using server time.

### Returned State
After an accepted update, the API returns the stored playback state:
- `episodeId`
- `positionSeconds`
- `lastUpdated`
- `nextEpisodeId`

If an update is ignored because it is stale or invalid for sync purposes, the API should still return the current stored playback state instead of failing.

`nextEpisodeId` rules:
- For ordinary progress updates and ignored stale updates, `nextEpisodeId` is `null`.
- If playback completion finishes a non-last playlist item, `nextEpisodeId` is `null`; normal sequential playback remains a frontend concern.
- If playback completion finishes the last playlist item and an eligible earlier unlistened playlist item exists, `nextEpisodeId` contains the topmost eligible episode ID in playlist order.

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

`GET /api/playback/queue` returns the current playlist queue and a nullable `activePlayback` object.
Clients should:
- show `activePlayback.episodeId` in the player when it is present in `queue`
- fall back to the first queue item when `activePlayback` is `null` or no longer present in `queue`
- not auto-start playback after loading queue state
- call `PUT /api/playback/active` when the user explicitly starts an episode
- call `PUT /api/playback/active` when the client automatically advances to the next episode
- not call `PUT /api/playback/active` for progress sync, pause, or seek

Active playback is cleared when the active episode is removed from the playlist, marked listened, completed through playback completion, or deleted with its podcast.

### Notes
- This keeps sync simple for a personal multi-device app.
- Forward progress is preferred over accidental regressions.
- Small backward jumps are treated as noise unless they are explicit seeks.
- Completion always wins over partial progress.

## File Lifecycle

### Decision
Downloaded episode files are temporary local copies. By default, removing an episode from the playlist deletes its downloaded file, and marking an episode as listened deletes its downloaded file.
Manual listened-state changes and playlist removal are immediate actions. The backend applies their file lifecycle side effects immediately.
Podcast unsubscribe keeps a 15-second undo window. During that window, the app keeps the downloaded files and applies the file-deleting unsubscribe only after the undo window expires.

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
- Smart Listening is always enabled and has no user-facing toggle.
- Adding an episode to playlist schedules its automatic download after a 15-second cancellation window.
- Removing the episode during that window cancels the scheduled download because the playlist row is removed.
- Existing playlist items without a valid local file are eligible for immediate download after backend startup or migration.
- The backend downloads playlist items in the background and prevents concurrent duplicate downloads of the same episode.
- If a valid local file already exists, the app should not download it again.
- If a file is missing or invalid, the app may redownload it.
- Filenames must be sanitized before writing to disk.
- Remote filenames must not be trusted directly.
- Clients always use `GET /api/episodes/:id/audio`; the backend chooses local-file delivery when ready and authenticated upstream streaming otherwise.
- A client that wants to switch during active playback may poll the existing episode response while `downloaded = false`. When it becomes `true`, the client pauses, preserves the exact playback position, reloads the same audio URL, seeks to that position, waits until the local source is ready, and resumes. A controlled pause is preferred over a position jump.
- Web and Android clients may instead finish the current remote stream and use the local file on the next audio request; source switching is not required for API compatibility.
- The legacy manual download endpoints may remain for compatibility, but normal clients do not expose manual download controls.

### Deletion Rules
- `DELETE /api/episodes/:id/download` deletes the local file if it exists and clears `downloaded_path`.
- `DELETE /api/playlist/:episodeId` deletes the local file by default and clears `downloaded_path`.
- `PATCH /api/episodes/:id` with `isListened = true` deletes the local file by default, clears `downloaded_path`, and removes the episode from playlist.
- If there is no local file, these actions still succeed as state updates.

### Undo Window For Destructive UI Actions
- Podcast unsubscribe exposes `Undo` and keeps the previous backend/file state during the 15-second undo window.
- The pending unsubscribe state is frontend-only; the backend does not mark the podcast, episodes, playlist entries, playback state, or downloads as pending during the undo window.
- During the unsubscribe undo window, downloaded files remain saved and `downloaded_path` remains valid.
- If the user clicks `Undo`, cancel the pending unsubscribe; the podcast, episodes, playlist entries, playback state, and downloaded files remain unchanged.
- If the undo window expires, commit the unsubscribe and apply the normal podcast-deletion file lifecycle rule.
- Manual mark-listened, mark-unlistened, `Mark all listened`, and remove-from-playlist do not use the 15-second undo window in MVP.
- These non-undo actions should update quickly in the UI and then reconcile from backend state.

### Marking Listened
- Marking an episode as listened updates `is_listened = true`.
- By default, marking listened also deletes the downloaded file.
- Marking an episode as listened removes it from playlist.
- Manual mark-listened is immediate and does not show a 15-second undo banner.
- The downloaded file is deleted when the backend mark-listened action commits.
- Marking an episode as unlistened does not restore a file that was already deleted by a committed action.
- If playback completion marks an episode as listened, the same file deletion rule applies.
- A frontend `Mark all listened` action may mark all affected unlistened episodes for the selected podcast as listened.
- `Mark all listened` is immediate and follows the same file and playlist lifecycle rules as individual mark-listened actions.
- A separate bulk backend endpoint is not required for MVP; the frontend may commit individual mark-listened mutations immediately.

### Playlist Behavior
- Adding an episode to playlist schedules an automatic download after 15 seconds.
- Adding an episode to playlist marks it unlistened if it was listened.
- Removing an episode from playlist deletes its local file by default.
- Manual remove-from-playlist is immediate and does not show a 15-second undo banner.
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
- Smart Listening keeps source selection backend-owned; web and Android clients do not need to know whether an audio response is remote or local.

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
- The backend must load and use the configured timezone explicitly for scheduler execution instead of relying on the container's local clock.
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
- `timezone`
- `lastTrigger`
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
- `APP_BUILD=abc1234`
- `SOCKS5_HOST`
- `SOCKS5_PORT`
- `SOCKS5_USERNAME`
- `SOCKS5_PASSWORD`

Deployment note:
- `APP_BUILD` should be injected from the deploy environment, typically as the current short git commit hash.
- `.git` is excluded from the Docker build context, so the container cannot derive the commit hash on its own.
- Recommended deploy pattern:
  `APP_BUILD=$(git rev-parse --short HEAD) docker compose up -d --build`

### Session Defaults
- Authentication uses secure server-side sessions.
- Session secret comes from `SESSION_SECRET`.
- Cookie behavior may vary by environment, but production should use secure cookie settings where possible.
- Runtime must fail clearly if `SESSION_SECRET` is missing.

### Proxy Behavior
- Backend outbound targets sourced from user input or podcast feeds must use `http` or `https` and must not contain embedded URL credentials.
- The same outbound URL policy must be applied to the initial request and every redirect target, whether proxy usage is enabled or disabled.
- Private, loopback, and link-local HTTP(S) targets remain allowed because mpod is a trusted single-user self-hosted application and may consume feeds or media hosted on the local network.
- Endpoints that cause backend fetches remain session-authenticated; the authenticated user is allowed to intentionally access local-network podcast sources through mpod.
- SOCKS5 proxy configuration is optional.
- Default proxy runtime values are `SOCKS5_HOST=192.168.0.222` and `SOCKS5_PORT=1080`.
- If proxy variables are provided and proxy usage is enabled in Settings, they are used for:
  - RSS feed fetching
  - OPML import feed fetching
  - manual podcast refresh
  - scheduled podcast refresh
  - episode streaming
  - episode downloads
  - podcast artwork proxying
  - proxy runtime identity lookup
- When proxy usage is enabled, all backend outbound HTTP network operations must use the configured proxy path.
- Exception: authenticated playback streaming may make one direct retry only after the configured proxy path returns a failed or non-playable audio response. This avoids user-visible playback failure when a podcast CDN blocks a specific proxy exit. The retry applies only to `GET /api/episodes/:id/audio`; it does not apply to RSS fetching, OPML import, refresh, downloads, artwork proxying, or proxy identity lookup.
- If proxy variables are not provided, or if proxy usage is disabled in Settings, all backend outbound HTTP network operations use direct connection.
- The Settings screen must provide a proxy on/off switch when proxy configuration is available.
- The proxy switch controls whether configured proxy settings are used; it does not edit proxy host, port, username, or password.
- Partial proxy configuration should be treated as invalid if required proxy host/port values are incomplete.

### Timezone Behavior
- Runtime timezone is controlled by `TZ`.
- Scheduler interprets `DAILY_REFRESH_TIME` using `TZ`.
- Scheduler status may expose the configured timezone for UI clarity.
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
      APP_BUILD: abc1234
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
- Episode API responses must expose a frontend-safe display value for show notes.
- The preferred API field is `episodes.showNotes`.
- For compatibility, episode API `description` may return the same sanitized display text instead of raw feed HTML.
- The backend may keep raw feed-provided episode HTML in storage, but the frontend must not be required to trust or sanitize raw HTML itself.
- `podcasts.description` stores feed-level podcast description when available.
- `podcasts.image_url` stores feed artwork URL when available.
- The frontend must display `frontend/public/podcast_fallback.png` when podcast artwork is missing, still loading, or fails to load.
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
- Migrations should live under `server/migrations/`.
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

## Audiobook Support

### Decision
mpod supports local audiobook playback with cross-device sync. Audiobooks are scanned from a configured local directory (`AUDIOBOOKS_DIR`, default `/share/audio/abooks/`), watched automatically via Linux `inotify`, and played directly without server-side transcoding.

### File Formats
- Supported audio formats are strictly `.mp3`, `.m4b`, and `.m4a`.
- Supported image cover formats: `.jpg`, `.jpeg`, `.png` (`cover.jpg`, `cover.png`, `folder.jpg`).
- All supported formats are streamed directly to the browser with HTTP `Range` request support for seeking.
- No ffmpeg or on-the-fly transcoding is required.
- **File Manager / Explorer Filtering:** The file explorer view displays only supported audio file formats (`.mp3`, `.m4b`, `.m4a`) and directories. Non-supported files (such as `.txt`, `.pdf`, `.nfo`, `.exe`, `.ds_store`, etc.) are filtered out and not rendered in the UI.

### Directory Scanning Rules
The scanner traverses `AUDIOBOOKS_DIR` using standard recursive directory walking:
1. **Multi-file Audiobook (Folder with multiple audio files):**
   - The directory itself represents the **Audiobook**.
   - The directory name is the book title.
   - The parent directory (if not the root `AUDIOBOOKS_DIR`) represents the **Author**.
   - Direct audio files inside the directory are **Chapters/Tracks**, sorted naturally by filename (e.g. `01...`, `02...`).
2. **Single-file Audiobook (Standalone audio file):**
   - The audio file itself represents the **Audiobook** (with 1 chapter/track).
   - The file name (without extension) is the book title.
   - The parent directory (if not the root `AUDIOBOOKS_DIR`) represents the **Author**.
3. **Artwork:**
   - If a file named `cover.jpg`, `cover.png`, or `folder.jpg` exists in the book's directory, it is served as the book's artwork.

### inotify Watcher Rules
- On Linux, the backend starts a background file watcher using `fsnotify` (`inotify`) monitoring `AUDIOBOOKS_DIR` and its subfolders.
- File system events (`Create`, `Write`, `Remove`, `Rename`) trigger a debounced rescan with a 2–3 second delay after the last write to prevent reading files while they are still being copied.
- When new subdirectories are created, the watcher automatically attaches to them.

### Playlist Presentation & Chapters Modal
- An audiobook is represented in the playlist as **a single item**, regardless of how many chapters/tracks it contains.
- The playlist item displays the book title, author, and current chapter progress (e.g. `Chapter 3 of 12 • 15:40 / 30:00`).
- Clicking the playlist item opens the **Chapters Modal / Bottom Sheet** showing the full chapter list with duration and listening status.
- In the audio player, multi-track audiobooks replace the "Show Notes" button with a "Show Chapters" button that opens the same Chapters Modal.

### Auto-advance & Playback Sync
- Audiobooks use the existing playback sync mechanism to track position in seconds per chapter.
- When a chapter finishes (`completed = true` sent to `POST /api/playback`), the backend:
  - Marks that chapter as listened (`is_listened = true`).
  - Sets `nextEpisodeId` / `nextTrackId` to the next chapter in the audiobook.
- When the final chapter of an audiobook finishes:
  - The entire audiobook is marked completed and removed from the playlist.
  - Playback advances to the next item in the playlist (if one exists).

### File Safety & Deletion Policy
- Audiobook files on disk are permanent library media assets. mpod treats the audiobook directory as strictly read-only.
- mpod **never deletes** audiobook files or folders from disk under any circumstances (neither automatically upon playback completion or playlist removal, nor manually via any UI action).
- There is no file deletion functionality for audiobooks. Removing an audiobook from the playlist or marking it as listened affects only database state.

### Audiobook Endpoints

#### `GET /api/audiobooks`
Returns all scanned audiobooks with author, title, track count, total duration, and overall progress.

#### `GET /api/audiobooks/:id`
Returns detailed audiobook info including the ordered list of tracks/chapters and their individual playback progress.

#### `GET /api/audiobooks/:id/tracks/:trackId/audio`
Streams the chapter audio file with full HTTP `Range` request support.

#### `GET /api/audiobooks/:id/cover`
Serves the cover artwork image if present, or 404 if none.

#### `POST /api/audiobooks/rescan`
Forces a manual rescan of the audiobooks directory.

#### `DELETE /api/audiobooks/:id`
Deletes the audiobook records and optionally removes files from disk.

