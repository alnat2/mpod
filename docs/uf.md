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

mpod is a single-user browser-based podcast app.
For MVP, the UI should be compact and task-first.
It should feel like a personal "library + queue + player," not a large platform.

The main product loop is:

1. get access to the app
2. add or import podcasts
3. browse episodes
4. download or queue episodes
5. stream or play downloaded audio and resume across devices
6. let the app handle refresh and cleanup in the background

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

Backend rules:
- adding a podcast validates and fetches the feed before creation
- OPML import triggers immediate fetch for newly added subscriptions
- duplicate subscriptions are rejected by the backend

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
5. After `Show all` is active, the UI offers `Show unlistened podcasts` to return both the podcast cards and selected podcast episode list to the default unlistened-only filtered output.
6. User chooses a podcast card.
7. The episode list area updates in the same podcasts screen, showing unlistened episodes by default or all episodes while `Show all` is active.
8. User decides what to do with each episode:
   - add to playlist
   - download
   - mark listened or unlistened
9. When the selected podcast has unlistened episodes, user can choose `Mark all listened` from the selected podcast episode-list header.

Design intent:
- podcast browsing is the main organizational view
- the user should be able to move from subscription-level browsing to episode action with little friction
- the podcast selector should default to subscriptions with unlistened episodes so completed subscriptions do not crowd the main work view
- the `Show all` / `Show unlistened podcasts` control is screen-local state for Subscriptions; it does not need to persist after leaving the screen
- while `Show all` is active, selecting a different podcast keeps the episode list in all-episodes mode until the user returns to `Show unlistened podcasts`
- on the subscriptions page, the podcast-card container should show a visible area of two card rows
- when podcast cards do not fit inside that two-row visible area, the podcast-card container should scroll instead of expanding the visible area or adding a `Show less` collapse action
- single-podcast refresh can be exposed on podcast cards as a lightweight supporting action
- downloading and playlist operations should be available directly from episode lists
- episode rows should make title, date, downloaded state, listened state, and playlist state visible where relevant
- when an episode is already downloaded, the row-level download icon should switch to a muted visual state
- icon-only episode-row controls should use clear tooltips that match the current action or state: `Download`, `Downloaded`, `Add to playlist`, `Remove from playlist`, and `Mark as listened`
- when a download fails, show a dismissible notification at the top of the screen for 10 seconds and return the affected row to a normal inline `Download` action
- screen-level error and undo banners should render out of flow in a fixed overlay positioned `100px` from the top of the viewport
- the 10-second download-failure notification timeout is separate from the 15-second destructive-action undo window
- episode rows should use `Mark listened` and `Mark unlistened` actions for manual listened-state changes, not `Show listened` or `Show unlistened` filter buttons
- `Mark all listened` is a selected-podcast episode-list action, not a global action for all subscriptions
- in default Subscriptions mode, `Mark all listened` affects the selected podcast's currently shown unlistened episodes
- in `Show all` mode, `Mark all listened` affects only unlistened episodes for the selected podcast and leaves already listened episodes unchanged
- hide or disable `Mark all listened` when there are no unlistened episodes in the selected podcast's current episode-list scope
- do not expose a separate `Delete` or `Delete download` episode action in the MVP UI
- downloaded files are cleaned up through playback completion or manual `mark listened`
- manual listened and unlistened actions should be available without making them visually heavier than queue or download

Backend rules:
- episode state comes from backend data
- file existence reconciliation is a backend concern
- refresh must not overwrite user state such as listened status, playlist state, or playback progress

## Manual Refresh Flow

Goal:
- fetch the latest episodes for all subscribed podcasts

User steps:
1. User triggers refresh all from Subscriptions, or refreshes one podcast from its card, when at least one podcast subscription exists.
2. User waits for the backend refresh process.
3. New episodes appear if any were found.
4. Refresh status and last-checked state update.

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
- create an ordered queue of episodes for listening

User steps:
1. User adds episodes to the playlist from podcast or episode views.
2. The playlist becomes the listening queue.
3. User reviews order and current queue state in the Home screen playlist area.
4. User reorders items when priorities change.
5. User starts playback from any queued episode.

Design intent:
- the playlist is not a secondary feature, it is a core listening workflow
- the playlist is not a separate primary screen or route for MVP
- the playlist persists as a queue area on the Home screen
- queue management should feel lightweight and fast
- playlist order should be obvious and manipulable
- the playlist should feel like an actionable queue, not just a passive list

Backend rules:
- duplicate playlist entries are prevented by the backend
- playlist order is stored explicitly by the backend
- removing an episode from the playlist deletes its local file by default

## Download Flow

Goal:
- optionally store a local disposable copy for playback

User steps:
1. User triggers download for an episode.
2. User waits for download completion.
3. Episode becomes downloaded in the UI.

Design intent:
- show a clear loading state during download
- display whether an episode is downloaded
- avoid promising archival or permanent local storage
- make it clear that downloading is optional, not required before listening

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
6. If the user leaves and comes back later, the backend-provided playback state is used to resume.

Playback speed:
- the player should expose these speed options: `Speed 0.5x`, `Speed 0.75x`, `Speed 1x`, `Speed 1.3x`, `Speed 1.5x`, and `Speed 2x`
- if nothing has been selected yet, the default playback speed is `Speed 1.3x`
- playback speed selection should be restored from backend-owned state so it stays consistent across devices
- backend playback progress remains stored in seconds

When playback reaches completion:
- the episode is marked listened
- the episode is removed from playlist
- downloaded file cleanup follows approved backend behavior
- playback advances to the next playlist item if one exists

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
- an episode is marked listened when playback reaches 100 percent
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
2. Backend marks the episode listened according to approved playback rules.
3. Playlist and file side effects are reflected in the UI through refreshed backend state.

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
5. If proxy usage is enabled, user can view the current observed external IP and country reported by backend.
6. User views scheduler status.

Design intent:
- settings should stay small and operational
- expose only user-editable behavior, not internal system complexity
- scheduler state should be understandable without overwhelming the user
- proxy settings should be a simple on/off switch, not a host or credential editor
- proxy runtime identity should show backend-reported state such as off, active, unknown, or error

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

The authenticated app should revolve around three main sections:

1. Home
2. Subscriptions
3. Settings

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
- Home screen playlist/queue area
- settings screen
- persistent or semi-persistent player UI

This screen set is intentionally small and aligned with the MVP scope.

## Important UI States

The frontend should explicitly support these states:

- empty podcasts state
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

- exact navigation pattern
- exact mobile layout
- exact Home playlist/queue layout across desktop and mobile
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
