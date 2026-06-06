# mpod Screens

This document describes the recommended screen structure for mpod based on the general user flow.
It is intended to guide frontend routing, layout, and component planning.

## Screen Model

For MVP, the UI should be compact and task-first.
It should feel like a personal "library + queue + player," not a large platform.

The frontend should be structured around:

1. app states
2. primary routed screens
3. persistent authenticated UI
4. overlays and dialogs

This keeps the app simple and avoids treating every interaction as a separate page.

## App States

Before thinking about screens, the frontend should recognize three top-level app states:

1. setup required
2. login required
3. authenticated app

These are not just screens, they are different entry conditions for the application.

## Auth And Entry Screens

### 1. Registration Screen

Use when:
- no user exists yet

Purpose:
- complete one-time app setup

Content:
- username field
- password field
- show/hide password button
- submit action

UX notes:
- this should be framed as first-time setup, not open registration
- language should make it clear this creates the only account for the app
- password is hidden by default and can be revealed temporarily from the field control

### 2. Login Screen

Use when:
- a user already exists but there is no valid session

Purpose:
- re-enter the authenticated app

Content:
- username field
- password field
- show/hide password button
- login action

UX notes:
- keep it simple and fast
- no unnecessary extra options for MVP
- no forgot password flow for MVP
- password is hidden by default and can be revealed temporarily from the field control

## Authenticated App Structure

The authenticated experience should use one consistent app shell.

Recommended shell structure:
- top bar with navigation
- primary navigation
- main content area
- persistent bottom player bar when audio is loaded
- mobile-friendly playback controls

Desktop layout guidance:
- desktop screen mockups should use a `1440px` wide frame
- authenticated page content should use a centered `1200px` maximum width
- at the `1440px` desktop frame size, this leaves `120px` side gutters
- full-width shell surfaces may span the frame, while inner navigation and page content should align to the centered content width where practical

Primary navigation should expose:
1. Home
2. Subscriptions
3. Settings

## Primary Screens

### 3. Subscriptions Screen

Purpose:
- default landing screen after setup or login
- browse subscribed podcasts
- provide main entry points for adding content

Content:
- podcast list or grid
- add podcast action
- import OPML action
- refresh all action when at least one podcast subscription exists

OPML export:
- available from Settings, not from the podcasts empty state

For each podcast:
- artwork
- title
- episode count
- last checked time where space allows
- manual refresh action for that podcast where space allows

Default podcast visibility:
- show podcasts with unlistened episodes by default
- by default, the selected podcast episode list should also show only unlistened episodes
- provide a `Show all` action to remove the default podcast filter and show every subscribed podcast, regardless of whether it currently has unlistened episodes
- when `Show all` is active, the selected podcast episode list should also show all episodes for that podcast, including listened and unlistened episodes
- when all podcasts are visible, provide `Show unlistened podcasts` to return both the podcast cards and the selected podcast episode list to the default unlistened-only filtering
- the `Show all` / `Show unlistened podcasts` state is local to the Subscriptions screen and does not need to persist after leaving that screen
- while `Show all` is active, selecting a different podcast keeps the selected podcast episode list in all-episodes mode until the user returns to `Show unlistened podcasts`
- the subscriptions page podcast-card container should show a visible area of two card rows
- if podcast cards do not fit inside that two-row visible area, keep the same filter controls and enable scrolling inside the podcast-card container instead of expanding the visible area or adding a `Show less` collapse action

States:
- empty state when no podcasts exist
- normal populated state
- loading state for refresh
- failed feed fetch state where relevant

UX notes:
- this is the operational home of the app
- when empty, the screen should strongly guide toward add podcast or import OPML
- when empty, do not show refresh all because there are no podcast subscriptions to refresh

### 4. Selected Podcast Episodes Area

Purpose:
- browse the selected podcast and act on its episodes inside the main podcasts screen

Routing note:
- a distinct podcast detail route or screen is not required at this stage
- selecting a podcast card can update the episode list area in the same podcasts screen

Content:
- selected podcast context from the podcast card
- `Mark all listened` action when the selected podcast has unlistened episodes in the current episode-list scope
- full podcast description on hover where useful
- episode list

For each episode row:
- title
- publication date
- duration when available
- listened state
- downloaded state
- in-playlist state where useful
- primary actions

Default episode visibility:
- the selected podcast episode list should show unlistened episodes by default
- the selected podcast episode list should show listened and unlistened episodes only when the parent subscriptions view is in the `Show all` state
- episode rows should expose manual listened-state actions instead of separate `Show listened` or `Show unlistened` filter buttons

Recommended episode actions:
- add to playlist
- remove from playlist when relevant
- download
- mark listened
- mark unlistened when relevant
- mark all listened from the selected podcast episode-list header when relevant

Row and state guidance:
- follow the canonical action, tooltip, and state rules in [frontend-decisions.md](frontend-decisions.md#manual-listened-state-actions)
- downloading and playlist actions should be one tap from the episode list
- while an episode is downloading, its row-level `Download` button should show a loading icon and should not start a second download request
- when an episode is already downloaded, its row-level download icon should use muted color treatment
- do not expose a separate `Delete` or `Delete download` action in the MVP UI
- downloaded files are cleaned up through playback completion or manual `mark listened`
- manual `Mark listened` and `Mark all listened` remove affected episodes from playlist after the backend mark-listened action commits
- mark listened and mark unlistened should be available from the episode row or an episode action menu
- do not use `Show listened` or `Show unlistened` buttons for episode filtering in the MVP UI
- download failures should show a dismissible notification at the top of the screen for 10 seconds, and the affected episode row should show the normal inline `Download` action again
- the 10-second download-failure notification timeout is separate from the 15-second destructive-action undo window
- episodes with no usable audio should be disabled or hidden rather than presented as normal playable items

UX notes:
- this should be optimized for repeated scanning and quick actions
- episode rows are likely the most important reusable app-specific UI unit

### 5. Home Queue / Playlist Area

Purpose:
- manage the active listening queue from the Home screen

Content:
- ordered list of playlist episodes
- current playback indicator where relevant
- reorder interaction
- remove from playlist action

States:
- empty playlist state
- populated queue state

UX notes:
- the playlist is not a separate primary screen or route for MVP
- the playlist persists as a queue area on the Home screen
- the playlist should feel like a working queue, not a static library
- reordering should be straightforward and reliable
- clear completed is not required for the first MVP

### 6. Settings Screen

Purpose:
- expose operational configuration and status

Content:
- export OPML
- daily refresh time setting
- scheduler status information
- proxy usage switch when SOCKS5 proxy configuration is available
- read-only proxy configured status
- read-only proxy runtime identity status with external IP and country when proxy usage is enabled
- logout action

UX notes:
- settings should remain small and practical
- this is not a profile-management area in the multi-user sense
- the proxy control should be a simple on/off switch; host, port, username, and password remain runtime configuration
- when proxy usage is disabled, the settings view should show `Proxy is off`
- when proxy usage is enabled and runtime lookup succeeds, the settings view should show the observed external IP and country label returned by backend
- when proxy runtime lookup fails, the settings view should show an explicit unknown/error state from backend rather than inventing geo or connectivity details
- for daily refresh time, the save action should be secondary when the time has not changed and primary only after the user changes the time
- do not add cleanup toggles unless product decisions are intentionally changed

## Persistent Authenticated UI

### 7. Player Bar

This is a persistent component, not a primary route.

Purpose:
- keep playback available while the user browses the app

Content:
- episode title
- podcast name
- play or pause
- progress display and seek affordance
- skip backward and forward
- playback speed control with the approved speed options:
  - `Speed 0.5x`
  - `Speed 0.75x`
  - `Speed 1x`
  - `Speed 1.3x`
  - `Speed 1.5x`
  - `Speed 2x`
- optional entry point to expanded controls if later approved

Behavior:
- visible when an episode is loaded for playback
- remains available across authenticated screens
- uses backend audio streaming for playback, preferring downloaded audio when available
- default playback speed is `Speed 1.3x`

UX notes:
- this should be central to the app experience
- it allows browsing and listening to coexist, which is important for mpod
- mobile playback controls should be treated as first-class, not as a desktop afterthought

## Supporting Overlays And Dialogs

These should not become full pages unless implementation reveals a clear need.

### Add Podcast Dialog

Purpose:
- collect RSS URL and submit subscription

### Import OPML Dialog

Purpose:
- upload and submit OPML file

### Undo Feedback

Purpose:
- give the user a short recovery path after podcast unsubscribe without interrupting task flow

MVP use:
- podcast unsubscribe

UX notes:
- prefer toast, banner, or inline feedback with an `Undo` action instead of blocking confirmation dialogs
- screen-level undo and error banners should render in a fixed overlay instead of taking space in the page layout
- fixed screen-level banners should be positioned `100px` from the top of the viewport
- undo must be a real recovery path, not only reassuring copy
- undo feedback should remain available for 15 seconds before it disappears
- undo feedback should show a live countdown of the remaining seconds in the undo window
- manual UI actions that expose undo and delete downloaded files should keep the downloaded file during the undo window
- if the user clicks `Undo`, cancel the pending action and restore the previous row state, including downloaded state
- if the undo window expires, commit the action and let the backend apply the approved file lifecycle rule
- podcast unsubscribe is the MVP action that exposes the 15-second undo window
- the podcast unsubscribe pending state is frontend-only until the undo window expires and the frontend sends the backend unsubscribe request
- manual mark-listened, mark-unlistened, `Mark all listened`, and remove-from-playlist do not expose the undo window in MVP
- those immediate actions may still have file lifecycle side effects; communicate consequences at the action point where needed and reconcile final state from the backend
- if a future action cannot be safely undone, communicate the consequence clearly at the action point

### Unsubscribe Action

Purpose:
- remove a podcast subscription from the Subscriptions screen

Use for:
- podcast-level `Unsubscribe` actions on podcast cards or podcast-level action areas

UX notes:
- use `Unsubscribe`, not `Delete podcast`, in the product UI
- communicate that unsubscribing removes the podcast, its episodes, playlist entries, playback state, and downloaded files
- use undo feedback for unsubscribe instead of a confirmation modal; commit the backend deletion only after the undo window expires
- do not promise file restoration after the unsubscribe action has committed

### Lightweight Scheduling Control

Use inline control or small dialog for refresh time editing.
This does not need its own route.

## Not Recommended As MVP Screens By Default

These may be revisited later, but should not be treated as required screens now:

- expanded player screen
- separate episode detail route
- storage-management screen

## Recommended Route Shape

A simple route map should be enough:

- `/setup`
- `/login`
- `/podcasts`
- `/settings`

The Home queue, player bar, and dialogs should live inside the authenticated app shell rather than as separate routes.
The selected podcast episode list should live inside `/podcasts` for now rather than a separate `/podcasts/:podcastId` route.

## Screen Priorities For Frontend Implementation

Build in this order:

1. app bootstrap and auth-state handling
2. registration screen
3. login screen
4. authenticated app shell
5. Subscriptions screen
6. selected podcast episode list inside the Subscriptions screen
7. home queue / playlist area
8. settings screen
9. persistent player bar
10. supporting dialogs and undo feedback

## Key UI Implications

- route count should stay small
- most work should happen inside a stable authenticated shell
- primary screens should support fast scanning and direct actions
- playback should remain accessible without leaving the current screen
- overlays should handle focused tasks without creating unnecessary navigation depth
- inline actions should be preferred over separate action screens
