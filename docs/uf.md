# General User Flow for mpod

This document describes the recommended general user flow for the mpod frontend.
It is intended to guide frontend structure and UX/UI decisions without redefining approved backend behavior.

If this document conflicts with higher-priority project documents, follow:
1. [docs/product-decisions.md](product-decisions.md)
2. [docs/architecture.md](architecture.md)
3. [prd.md](../prd.md)
4. [AGENTS.md](../AGENTS.md)
5. this document

## Product Shape

mpod is a single-user browser-based podcast and local-audiobook app.
For MVP, the UI should be compact and task-first.
It should feel like a personal "library + queue + player," not a large platform.

The main product loop is:

1. get access to the app
2. add or import podcasts
3. browse podcast episodes or the read-only local audiobook collection
4. queue podcast episodes, whole books, or selected audiobook chapters
5. stream podcasts or play local audiobook files and resume across devices
6. let the app handle podcast refresh, disposable downloads, and cleanup in the background

The frontend should keep this loop simple, visible, and clearly backed by server state.

## Frontend Authority Boundaries

The frontend should:
- render application state returned by the backend
- keep routing and navigation simple
- guide the user through the main tasks with minimal friction
- show loading, empty, error, and destructive-action states clearly
- prefer undo feedback over blocking confirmation dialogs for destructive or high-impact actions

The frontend should not:
- decide feed deduplication rules
- decide playback conflict resolution
- manipulate files directly
- store authoritative playback state long-term
- invent behavior that conflicts with approved backend rules

## Top-Level App States

At startup, the frontend should check session and setup state, then enter one of three app states:

1. setup required
2. login required
3. authenticated app

The backend session response determines the state:
- `setupRequired: true` means show the initial setup flow
- `authenticated: false` means show the login flow
- `authenticated: true` means show the main app

This is the first major user-flow decision because it defines the app shell and route guards.

## First-Time Setup Flow

Goal:
- create the only user account and enter the app immediately

User steps:
1. User opens mpod for the first time.
2. Frontend checks backend auth/setup state.
3. If no user exists, the app shows the one-time registration flow.
4. User creates the only account with username and password.
5. After successful setup, the user enters the authenticated app.
6. The initial landing state should be Subscriptions, which may be empty.

Design intent:
- setup should feel like first-run initialization, not public registration
- there should be no language suggesting multi-user support
- the empty state should immediately guide the user toward adding a podcast or importing OPML
- the password field should hide the value by default and allow a temporary show/hide toggle

Backend rules:
- registration is allowed only if no user exists
- successful registration creates the only user
- successful registration also creates the session

## Returning User Login Flow

Goal:
- authenticate the existing user and return to the app

User steps:
1. User opens mpod.
2. Frontend checks backend auth/setup state.
3. If a user exists but no valid session is present, show login.
4. User logs in with username and password.
5. After successful login, the user returns to the authenticated app.

Design intent:
- login should be plain and fast
- the app should prioritize immediate access over extra auth ceremony
- there is no public registration and no forgot password flow for MVP
- if the session is still valid, skip login and go directly to the main app
- the password field should hide the value by default and allow a temporary show/hide toggle

Backend rules:
- login is session-based
- invalid credentials are returned as backend errors
- logout clears the session

## Empty Library Flow

Goal:
- get the user from an empty app to the first useful content

User steps:
1. User reaches the authenticated app with no podcast subscriptions yet.
2. The Subscriptions screen presents an empty state.
3. The UI offers two clear primary actions:
   - add podcast by RSS URL
   - import subscriptions from OPML
4. After successful import or add, the user moves into the normal browsing flow.

Design intent:
- the first useful action should be obvious
- the empty state should reduce uncertainty, especially for self-hosted users landing in a blank app
- the empty state should be useful without becoming a marketing page
- this state is only for no subscriptions; if subscriptions exist but all are listened, use the all-caught-up Subscriptions state instead

Backend rules:
- adding a podcast validates and fetches the feed before creation
- OPML import triggers immediate fetch for newly added subscriptions
- duplicate subscriptions are rejected by the backend

## All Caught Up Subscriptions Flow

Goal:
- explain the default Subscriptions view when subscribed podcasts exist but none have unlistened episodes

User steps:
1. User opens Subscriptions while the default unlistened-only filter is active.
2. The backend returns subscriptions, but no subscribed podcast has unlistened episodes.
3. The UI shows an all-caught-up empty state instead of the no-subscriptions state.
4. User can add another RSS feed, import OPML, or choose `Show all` to browse listened episodes.

Design intent:
- avoid implying that the library is empty when subscriptions still exist
- keep the next useful actions visible without adding a separate route or extra filter UI

Backend rules:
- podcast and episode state still comes from the backend
- the frontend decides which empty state to show from the returned subscriptions and listened-state flags

## Add Podcast Flow

Goal:
- subscribe to a new podcast from a feed URL

User steps:
1. User chooses add podcast.
2. User enters an RSS feed URL.
3. Backend validates and imports the podcast.
4. Episodes appear under that podcast after import completes.
5. User is returned to Subscriptions with the new podcast visible.

Design intent:
- adding a podcast should feel fast and lightweight
- show loading state while the backend validates and fetches the feed
- surface backend validation errors clearly
- success should take the user back into browsing, not into a dead-end confirmation state

Backend rules:
- the backend fetches and parses the feed before creating the podcast
- invalid or unreachable feeds return an error
- duplicate subscriptions are rejected

## OPML Import And Export Flow

Import goal:
- migrate subscriptions into mpod

Import steps:
1. User chooses import OPML.
2. User selects an OPML file.
3. Backend imports non-duplicate subscriptions and fetches feeds for newly added podcasts.
4. Imported podcasts appear in Subscriptions.
5. User can immediately browse those podcasts and episodes.

Export goal:
- download current subscriptions as an OPML file

Export steps:
1. User opens Settings and chooses export OPML.
2. Browser receives an OPML file download for current subscriptions.

Design intent:
- import should feel like a bulk-start path for users migrating from another podcast tool
- import should clearly report success and skipped duplicates
- export should feel immediate and predictable
- import results should be visible in the main app, not hidden behind a separate results screen unless notable errors need attention

Backend rules:
- import only creates new subscriptions where appropriate
- export reflects current subscriptions

## Podcast Browsing Flow

Goal:
- explore subscriptions and choose episodes to download, queue, or mark listened/unlistened

User steps:
1. User lands in Subscriptions.
2. User sees podcasts with unlistened episodes by default.
3. If at least one podcast subscription exists, user can refresh all podcasts from Subscriptions or refresh a single podcast from its card.
4. User can choose `Show all` to show every subscribed podcast, regardless of listened or unlistened episode state; the selected podcast episode list also switches to all episodes, including listened and unlistened episodes.
5. After `Show all` is active, the UI offers `Show unlistened` to return both the podcast cards and selected podcast episode list to the default unlistened-only filtered output.
6. User chooses a podcast card.
7. The episode list area updates in the same podcasts screen, showing unlistened episodes by default or all episodes while `Show all` is active.
8. User decides what to do with each episode:
   - add to playlist
   - mark listened or unlistened
9. When the selected podcast has unlistened episodes, user can choose `Mark all listened` from the selected podcast episode-list header.

Design intent:
- podcast browsing is the main organizational view
- the user should be able to move from subscription-level browsing to episode action with little friction
- the podcast selector should default to subscriptions with unlistened episodes so completed subscriptions do not crowd the main work view
- detailed Subscriptions filtering and podcast-card container rules are canonical in [frontend-decisions.md](frontend-decisions.md#subscription-list-defaults)
- single-podcast refresh can be exposed on podcast cards as a lightweight supporting action
- playlist operations should be available directly from episode lists
- episode rows should make title, date, downloaded state, listened state, and playlist state visible where relevant
- detailed episode-row action labels, download state treatment, and manual listened-state rules are canonical in [frontend-decisions.md](frontend-decisions.md#manual-listened-state-actions)
- mobile episode actions are displayed directly in each card; the episode action flow does not use a bottom sheet
- screen-level error and undo banners should render out of flow in a fixed overlay positioned `100px` from the top of the viewport
- episode rows should use `Mark listened` and `Mark unlistened` actions for manual listened-state changes, not `Show listened` or `Show unlistened` filter buttons
- do not expose a separate `Delete` or `Delete download` episode action in the MVP UI
- downloaded files are cleaned up through playback completion or manual `mark listened`
- manual listened and unlistened actions should be available without making them visually heavier than queue or show notes

Backend rules:
- episode state comes from backend data
- file existence reconciliation is a backend concern
- refresh must not overwrite user state such as listened status, playlist state, or playback progress

## Manual Refresh Flow

Goal:
- fetch the latest episodes for all subscribed podcasts

User steps:
1. User triggers refresh all from Subscriptions, or refreshes one podcast from its card, when at least one podcast subscription exists.
2. For refresh all, the backend accepts a background refresh job and the Subscriptions refresh control returns to idle after the job is accepted.
3. The frontend watches refresh status through the scheduler status endpoint.
4. New episodes appear after the background refresh completes, if any were found.
5. Refresh status and last-checked state update.

Design intent:
- refreshing should feel safe and understandable
- report success even when no new episodes are found
- refresh is a supporting system behavior, not the center of the app
- per-podcast manual refresh is allowed as a lightweight podcast-card action

Backend rules:
- refresh reuses the same underlying import logic as scheduled refresh
- refresh must preserve user state on existing episodes

## Playlist Building Flow

Goal:
- create an ordered mixed queue for listening

User steps:
1. User adds podcast episodes from Podcasts or adds audiobook content from Abooks.
2. For a standalone audiobook file, the user adds one book item.
3. For a folder-backed audiobook, the user may add the whole book or selected chapters.
4. Selected chapters from the same folder are merged into one book item and follow natural filename order.
5. The playlist becomes the listening queue.
6. User reviews order and current queue state in the Player screen playlist area.
7. User reorders top-level podcast and audiobook items when priorities change.
8. User starts playback from any queued item.

Design intent:
- the playlist is not a secondary feature, it is a core listening workflow
- the playlist is not a separate primary screen or route for MVP
- the playlist persists as a queue area on the Player screen
- queue management should feel lightweight and fast
- playlist order should be obvious and manipulable
- the playlist should feel like an actionable queue, not just a passive list
- a folder-backed audiobook should never fragment into separately reorderable queue rows

Backend rules:
- duplicate playlist entries are prevented by the backend
- playlist order is stored explicitly by the backend
- removing an episode from the playlist deletes its local file by default
- removing audiobook content from the playlist never deletes source files

## Audiobook Library Flow

Goal:
- browse and queue books from the configured read-only filesystem library

User steps:
1. User opens the separate `Abooks` screen.
2. User navigates collection folders through breadcrumb-based levels.
3. A standalone supported audio file is presented as a single-track book that can be added directly.
4. A folder containing direct supported audio files is presented as one folder-backed book.
5. User may add that whole book or open its chapter list and select individual chapters.
6. Adding more chapters updates the same playlist item; adding the whole book fills it with every missing chapter.
7. User may manually rescan the library when needed.

Design intent:
- collection folders are navigation only and have no playlist action
- chapter selection supports both sequential books and collections of stories stored in one folder
- newly scanned chapters appear in the library but do not silently change an existing playlist item
- there is no delete-book action in the library UI

Backend rules:
- `AUDIOBOOKS_DIR` defaults to `/share/audio/abooks/`
- supported audio formats are `.mp3`, `.m4b`, and `.m4a`
- source files are strictly read-only
- automatic and manual rescans update library metadata without deleting or modifying media

## Download Flow

Goal:
- reflect automatic disposable downloads without exposing manual controls

User steps:
1. User adds an episode to the playlist.
2. Backend schedules and completes the download automatically.
3. Episode downloaded state updates in the UI.

Design intent:
- display whether an episode is downloaded
- do not expose a manual `Download` action
- avoid promising archival or permanent local storage
- do not require a local download before listening

Backend rules:
- download paths and file lifecycle are controlled by the backend
- the local file is a disposable copy, not archival media
- playback can stream through the backend when no local file exists

## Listening Flow

Goal:
- listen to streamed or downloaded audio, continue browsing, and resume later

User steps:
1. User starts playback from an episode row or from the playlist.
2. The player becomes visible as persistent UI in the authenticated app.
3. Playback controls remain usable on both desktop and mobile layouts.
4. User continues browsing while audio plays.
5. Playback progress is sent to the backend periodically.
6. If a local download becomes available during active playback, the web player
   preserves the position, reloads the same audio URL, restores the position,
   and resumes after the source is ready.
7. If the user leaves and comes back later, the backend-provided playback state is used to resume.

Playback speed:
- playback speed options and default speed are canonical in [frontend-decisions.md](frontend-decisions.md#playback-speed-control)
- on mobile, choosing the playback speed opens a bottom sheet; selecting an option applies it and closes the sheet
- playback speed is the only mobile Player control that uses the bottom sheet
- on desktop, playback speed remains available from the dropdown menu
- podcast and audiobook speed selections should be restored independently from backend-owned state so they stay consistent across devices
- podcast speed defaults to `Speed 1.3x`; audiobook speed defaults to `Speed 1x`
- changing one content-type speed must not change the other
- backend playback progress remains stored in seconds

Player content actions:
- a podcast episode exposes `Show notes`
- a folder-backed multi-track audiobook exposes `Show chapters`
- a standalone audiobook file exposes neither of these secondary actions
- selecting the current playback time opens `Go to time`, with hour-and-minute input for long-form audio

Audiobook chapter dialogs:
- opening a folder-backed audiobook from `Abooks` opens the library chapter-selection dialog
- the library dialog shows each chapter's name, duration, and add/remove-from-playlist action; it has no Play, Pause, Replay, or current-position controls
- opening a folder-backed audiobook from the Player queue, or choosing `Show chapters`, opens the playback chapters dialog
- the playback dialog distinguishes completed/replay, current playing, current paused, and upcoming chapters

When playback reaches completion:
- the client sends `POST /api/playback` with `completed: true` only after the audio engine reports actual completion
- the episode is marked listened
- the episode is removed from playlist
- downloaded file cleanup follows approved backend behavior
- playback advances to the next playlist item if one exists
- if completion finishes the last playlist item, the backend returns the topmost eligible earlier podcast episode or audiobook chapter as typed `nextTarget`
- the refreshed queue starts that exact target, resuming its playback state or using `0:00`, and actually starts the audio engine
- if no eligible remaining item exists, playback stops
- for an audiobook, the completed chapter remains visible in the chapter list and playback advances to the next selected chapter
- when the final selected audiobook chapter becomes listened, the book is removed from the playlist and the next top-level item may start
- a later re-add starts the completed or manually removed book from a clean state at `0:00`

Design intent:
- listening should not trap the user in a separate player-only screen
- pressing play should not require downloading first
- the persistent player should support multitasking inside the app
- mobile playback should be treated as a first-class use case
- the active episode and playback progress should be visible enough to continue listening easily

Backend rules:
- if a local download exists, playback should use it
- if no local download exists, playback should stream through the backend
- playback sync logic and conflict resolution belong to the backend
- playback progress is persisted by the backend
- near-end position sync does not mark an episode listened or remove it from playlist
- only a request with `completed: true`, sent after actual audio completion, triggers completion side effects
- the frontend should not invent its own long-term playback authority

## Cross-Device Resume Flow

Goal:
- resume listening from backend-saved position on another browser or device

User steps:
1. User starts listening on one device.
2. Playback state is stored by the backend.
3. User opens mpod on another device.
4. The same episode can resume from stored position using backend state.

Design intent:
- resume should feel dependable, but the backend remains the authority
- the frontend should display resume state clearly without inventing its own sync logic

## Manual Listened State Flow

Goal:
- let the user manually correct listened state while keeping backend lifecycle rules authoritative

Mark listened behavior:
1. User chooses mark listened from an episode row or episode action menu.
2. UI updates the row immediately without showing a 15-second undo banner.
3. Backend marks the episode listened and applies approved file lifecycle behavior, including downloaded-file deletion by default.
4. UI reconciles listened and downloaded state from the backend response.

Mark all listened behavior:
1. User chooses `Mark all listened` from the selected podcast episode-list header.
2. UI updates the affected unlistened rows immediately without showing a 15-second undo banner.
3. Backend marks the affected episodes listened and applies approved file lifecycle behavior, including downloaded-file deletion by default.
4. UI reconciles listened and downloaded state from the backend responses.

Mark unlistened behavior:
1. User chooses mark unlistened from an episode row or episode action menu.
2. Backend clears listened state.
3. UI updates listened state from the backend response.
4. If the local file was previously deleted, the UI should not imply that marking unlistened restores it.

Automatic completion behavior:
1. User listens until playback reaches completion.
2. Client sends `POST /api/playback` with `completed: true`.
3. Backend marks the episode listened and returns any typed `nextTarget` (plus the legacy podcast alias when applicable).
4. Client starts that episode at its stored playback position, or at `0:00` when no playback state exists.
5. Playlist and file side effects are reflected in the UI through refreshed backend state.

Design intent:
- completion should feel automatic and predictable
- manual listened/unlistened should feel like a quick correction action, not the primary way to consume episodes
- listened state should be visible as metadata or filtering context
- manual listened-state actions should feel immediate and should not show undo feedback in MVP
- destructive unsubscribe should use undo feedback instead of a blocking confirmation dialog where practical
- unsubscribe undo feedback should remain available for 15 seconds before it disappears
- unsubscribe undo feedback should display the remaining undo window as a live seconds countdown
- for unsubscribe, file deletion should happen only after the 15-second undo window expires

Backend rules:
- marking an episode listened deletes its local file by default
- manual UI mark-listened is immediate, so deletion happens when the backend mutation commits
- marking an episode unlistened does not restore a file that was already deleted by a committed action
- final episode state is determined by the backend response

## Settings And Scheduler Flow

Goal:
- configure daily refresh time, proxy usage, understand scheduler status, and view current proxy runtime identity

User steps:
1. User opens settings.
2. User views the current daily refresh time.
3. User updates the daily refresh time if desired.
4. User turns configured proxy usage on or off if proxy configuration is available.
5. User views the latest refresh information on the first line below the Settings title.
6. User views proxy runtime identity on the second line below the Settings title; when proxy is enabled this includes the observed external IP and country reported by backend.

Design intent:
- settings should stay small and operational
- expose only user-editable behavior, not internal system complexity
- scheduler state should be understandable without overwhelming the user
- proxy settings should be a simple on/off switch, not a host or credential editor
- proxy runtime identity should show backend-reported state such as off, active, unknown, or error
- desktop and mobile use the same two-line page-header status order: last refresh, then proxy runtime identity
- the proxy card keeps static guidance while runtime status remains in the page header

Backend rules:
- scheduler runs once per day at one global configured time
- scheduler status comes from the backend
- proxy host, port, username, and password come from environment variables
- proxy enabled/disabled state is stored in database-backed settings
- proxy runtime identity comes from a backend status lookup and must not be invented by frontend

## Logout Flow

Goal:
- end the current browser session

User steps:
1. User triggers logout.
2. User returns to the login screen.

Design intent:
- logout should be available but low-friction
- after logout, protected app views should no longer be usable

Backend rules:
- logout destroys the session on the backend

## Cleanup And Lifecycle Flow

Users do not need to manually manage files as a primary workflow.
Instead, the app applies the approved lifecycle rules behind the scenes.

Important user-facing outcomes:
- removing an episode from playlist removes it from the queue immediately and deletes its local file by default when the backend mutation commits
- marking an episode as listened deletes its local file by default when the backend mutation commits
- marking an episode as unlistened restores listened state only, not deleted local files
- unsubscribing from a podcast removes the subscription, associated episodes, playlist entries, playback state, and downloaded files after the 15-second undo window expires

Design intent:
- cleanup should be predictable
- destructive outcomes should be communicated clearly at action time
- use undo feedback instead of confirmation dialogs for podcast unsubscribe
- keep unsubscribe undo feedback available for 15 seconds
- for unsubscribe, keep downloaded files during the undo window and commit file deletion only after the window expires
- if an action cannot be safely undone, explain the consequence before or at the action point without creating unnecessary modal friction

## Unsubscribe Flow

Goal:
- remove a podcast subscription and all data owned by that subscription

User steps:
1. User chooses `Unsubscribe` from a podcast card or podcast-level action area.
2. UI communicates that unsubscribing removes the podcast, its episodes, playlist entries, playback state, and downloaded files.
3. UI shows undo feedback and keeps the backend subscription unchanged during the undo window.
4. If the user clicks `Undo`, the pending unsubscribe is canceled and the podcast remains subscribed.
5. If the undo window expires, backend deletes the subscription and associated data according to approved lifecycle rules.
6. UI removes the podcast from Subscriptions and updates playlist/player state from backend state.

Design intent:
- use the product term `Unsubscribe`, not a generic `Delete podcast` label
- make the cascade clear at the action point because it affects more than the visible podcast card
- use undo feedback instead of a confirmation modal
- do not promise file restoration after the unsubscribe action has committed

Backend rules:
- podcast deletion behavior comes from the backend
- downloaded files for the podcast are deleted when the subscription is removed
- associated playlist entries and playback records are removed with the deleted episodes

## Recommended Navigation Model

The authenticated app should revolve around four main sections:

1. Player
2. Podcasts
3. Abooks
4. Settings

Persistent UI:
- player bar for current playback

Supporting overlays:
- add podcast
- import OPML
- undo feedback for destructive or high-impact actions

## Suggested First-Pass Screen Set

This document does not force a final route map, but a reasonable first-pass screen set is:

- setup screen
- login screen
- Subscriptions screen
- selected podcast episode list inside Subscriptions
- Abooks library screen with nested collection navigation
- audiobook library chapter-selection modal on desktop and bottom sheet on mobile
- audiobook playback chapters modal on desktop and bottom sheet on mobile
- Player screen playlist/queue area
- settings screen
- persistent or semi-persistent player UI

This screen set is intentionally small and aligned with the MVP scope.

## Important UI States

The frontend should explicitly support these states:

- empty podcasts state
- empty audiobook library state
- audiobook collection-folder state
- audiobook scan/rescan state
- audiobook library chapter-selection states: not selected and selected in the playlist item
- audiobook playback chapter states: completed/replay, current playing, current paused, and not started
- empty playlist state
- loading state for add/import
- loading state for refresh
- loading state for download
- failed feed fetch state
- failed download state
- unauthorized/session-expired state
- destructive action undo state
- disabled or unavailable state for episodes that have no usable audio, if such entries are ever shown

## Open UX/UI Refinement Areas

These flows are intentionally general. The following still need refinement in frontend planning:

- exact mobile layout
- exact Player playlist/queue layout across desktop and mobile
- how global player visibility should behave across screen sizes
- bulk actions, if any
- exact empty states and feedback patterns

## UX Principles Implied By This Flow

- the app should open quickly into the user's actual library state
- empty states should teach the next action
- browsing and listening should coexist
- playlist management should feel central, not buried
- settings should stay small and operational
- fewer screens and more inline actions should be preferred for MVP
- modal-heavy flows should be avoided unless they genuinely simplify a task
- the backend remains the source of truth for auth, playback, refresh state, and file lifecycle behavior
