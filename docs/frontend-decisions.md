# Frontend Decisions

This document captures approved frontend decisions for mpod so the frontend implementation chat can use them without rediscovering context from status notes.

If this document conflicts with higher-priority product docs, follow:
1. [docs/product-decisions.md](product-decisions.md)
2. [docs/architecture.md](architecture.md)
3. [prd.md](../prd.md)
4. this document

## Current Scope

This document is for:
- frontend stack choices
- UI library choices
- design library choices
- implementation guidance for the frontend chat

Related frontend planning notes:
- [docs/uf.md](uf.md)
- [docs/screens.md](screens.md)

This document is not for:
- re-deciding approved backend behavior
- changing API behavior unless explicitly approved
- implementation details that should live in the frontend codebase

## Approved Decisions

### Frontend UI Library

Decision:
- frontend implementation will use `shadcn/ui`

Reasoning:
- it fits the planned React frontend
- it supports a simple, maintainable component approach
- it keeps component code local and customizable instead of pushing the project into a heavyweight package-driven UI system
- it is a good fit for a small single-user self-hosted web app

### Figma Library

Decision:
- Figma design work will use the Sitsiilia `shadcn ui components with variables` library as the base design library
- Figma screen design should use Auto Layout by default

Reasoning:
- it aligns more directly with a `shadcn/ui` plus Tailwind-style implementation approach
- it is practical for screen design and handoff without introducing unnecessary design-system overhead
- it is the chosen design source for mpod screen work
- defaulting to Auto Layout should keep screens easier to maintain, adapt, and translate into responsive frontend implementation

Rule:
- do not use the Obra kit for mpod
- in mpod design and implementation notes, refer to common UI primitives by their simple component names, such as `Button`, `Input`, `Card`, `Dialog`, `Tabs`, `Badge`, and `Switch`
- descriptive annotation pills used to explain a design state, such as `first run`, `empty`, or `error`, should be placed outside the actual app screen/frame in Figma
- annotation pills are not part of the product UI unless they represent a real user-facing status badge

### Responsive Design Targets

Decision:
- MVP design work will cover desktop and mobile versions
- a separate tablet-specific design is not required for MVP

Desktop sizing:
- desktop Figma screens should use a `1440px` wide frame
- main page content should use a centered maximum width of `1200px`
- at `1440px`, the remaining width creates `120px` gutters on the left and right
- app shell surfaces such as the page background and persistent player may span the full desktop frame, but their inner content should align to the same centered `1200px` content width where practical

Mobile sizing:
- mobile screens should be designed separately from desktop screens
- mobile content should use mobile-safe side padding and layouts appropriate to the smaller viewport

Tablet:
- tablet layouts are out of scope for MVP as separate mockups
- implementation may interpolate between desktop and mobile behavior, but tablet is not a separate design target

### shadcn Skills

Decision:
- use `shadcn/ui` Skills during frontend implementation after the frontend scaffold exists and `components.json` is present

Reasoning:
- it should help coding agents stay aligned with the local `shadcn/ui` setup
- it reduces mistakes around component patterns, CLI usage, and project configuration

### shadcn MCP

Decision:
- `shadcn/ui` MCP is not part of the initial project setup

Reasoning:
- mpod does not currently need multi-registry browsing or registry-driven component discovery
- adding MCP early would increase setup complexity without clear MVP benefit

Rule:
- reconsider MCP later only if registry browsing becomes a real repeated need during frontend implementation

### Destructive Action Pattern

Decision:
- prefer an undo pattern instead of blocking confirmation dialogs for destructive or high-impact UI actions

Reasoning:
- mpod is a task-first personal tool, so frequent confirmation dialogs would slow down common queue and library work
- undo keeps the interaction fast while still giving the user a short recovery path
- this fits the product direction of fewer modal interruptions and more inline feedback

Rules:
- undo must be a real recovery path, not just reassuring copy
- destructive-action undo feedback should remain available for 15 seconds
- destructive-action undo feedback must show the remaining undo time as a live countdown, not static `15 seconds` copy
- screen-level error and undo banners must render out of normal page flow in a fixed overlay
- screen-level error and undo banners must sit `100px` from the top edge of the viewport
- manual UI actions that expose undo and delete downloaded files should keep the downloaded file during the undo window
- if the user clicks `Undo`, cancel the pending action and restore the previous row state, including downloaded state
- if the undo window expires, commit the action and let the backend apply the approved file lifecycle rule
- podcast unsubscribe is the MVP action that uses the 15-second destructive-action undo window
- the podcast unsubscribe pending state is frontend-only until the undo window expires and the frontend sends the backend unsubscribe request
- manual mark-listened, mark-unlistened, `Mark all listened`, and remove-from-playlist are immediate actions and do not show undo feedback
- if an action cannot be safely undone, the UI must clearly communicate the consequence at the action point
- use concise toast, banner, or inline feedback with an `Undo` action where practical
- avoid modal confirmations by default unless a future product decision explicitly requires one

### Manual Listened State Actions

Decision:
- expose manual `mark listened` and `mark unlistened` actions in the frontend UI
- expose a selected-podcast `Mark all listened` action in the Subscriptions episode-list header when the selected podcast has unlistened episodes in the current episode-list scope
- do not expose a separate `Delete` or `Delete download` action in the MVP UI
- do not use `Show listened` or `Show unlistened` filter buttons for episode rows in the MVP UI

Reasoning:
- the backend already supports listened/unlistened state changes
- a personal podcast queue benefits from quick manual correction when the user finishes elsewhere, skips an episode, or wants to restore an episode to the active/unlistened set
- this keeps the user in control without moving listened-state business rules into the frontend
- downloaded episode files are disposable, and the MVP cleanup path is marking an episode listened or completing playback

Rules:
- the backend remains the source of truth for listened state and file lifecycle behavior
- episode rows should expose `Mark listened` and `Mark unlistened` only where relevant for manual listened-state changes
- icon-only episode-row actions should use tooltips with state-specific labels:
  - `Add to playlist`
  - `Remove from playlist`
  - `Mark as listened`
- `Mark all listened` applies to the selected podcast episode list, not to every subscription in the app
- in default Subscriptions mode, `Mark all listened` marks the selected podcast's currently shown unlistened episodes as listened
- in `Show all` mode, `Mark all listened` marks only the selected podcast's unlistened episodes; episodes that are already listened are unchanged
- if there are no unlistened episodes in the selected podcast's current episode-list scope, hide or disable `Mark all listened`
- marking listened should communicate that the downloaded file is deleted by default
- downloaded files are cleaned up through playback completion or manual `mark listened`, not through a separate delete-download control
- manual `Mark listened` and `Mark all listened` are immediate actions and should not show a 15-second undo banner
- when manual `Mark listened` or `Mark all listened` commits, backend lifecycle behavior deletes downloaded files as appropriate and removes affected episodes from playlist
- marking unlistened should not imply that a file deleted by an already committed action will be restored

### Episode Action Presentation

Decision:
- mobile episode overflow actions open in the Figma-approved bottom Drawer
- desktop episode actions remain inline icon buttons

Rules:
- the Drawer header shows the episode title and podcast title
- the mobile Subscriptions action order is playlist state, show notes, listened state
- the mobile playlist action order is play or pause, then remove from playlist
- action availability and labels continue to reflect the current episode state

### Subscription List Defaults

Decision:
- subscription browsing should show podcasts with unlistened episodes by default
- the Subscriptions page header metadata should display the current number of subscribed podcasts and how many of those podcasts contain at least one unlistened episode, using the format `12 podcasts · 2 unlistened`; count each podcast at most once and do not display the latest refresh time
- by default, the selected podcast episode list should also show only unlistened episodes
- the selected podcast episode-list header summary should display total episode count and unlistened episode count for that podcast, for example `123 / 2 episodes`, instead of repeating the selected podcast name
- podcast cards may expose a manual refresh control for refreshing a single subscription
- when no subscriptions exist, the Subscriptions screen should use a dedicated empty state that points to adding an RSS feed or importing OPML
- when subscriptions exist but none have unlistened episodes in the default view, the Subscriptions screen should use a dedicated `all caught up` empty state instead of the no-subscriptions copy
- when a podcast card leaves the default Subscriptions view because the podcast is unsubscribed or because it no longer has unlistened episodes, use a subtle exit animation before removing the card from the visible list
- provide a `Show all` action to remove the default podcast filter and show every subscribed podcast, regardless of whether it currently has unlistened episodes
- when `Show all` is active, the selected podcast episode list should also show all episodes for that podcast, including listened and unlistened episodes
- when all podcasts are visible, provide `Show unlistened` to return both the podcast cards and the selected podcast episode list to the default unlistened-only filtered output
- the `Show all` / `Show unlistened` state is local to the Subscriptions screen and does not need to persist after leaving that screen
- while `Show all` is active, selecting a different podcast keeps the selected podcast episode list in all-episodes mode until the user returns to `Show unlistened`
- the subscriptions page podcast-card container should show a visible area of two card rows
- if podcast cards do not fit inside that two-row visible area, enable scrolling inside the podcast-card container instead of expanding the visible area or adding a `Show less` collapse action

Reasoning:
- this keeps the main subscriptions view focused on podcasts that currently need attention
- it still gives access to the full subscription list without adding a separate route or advanced filter UI

### Automatic Download State And Playback Source Switching

Decision:
- normal clients do not expose manual episode download controls
- episode rows may continue to display downloaded state as status information
- while an actively playing episode started with `downloaded = false`, the web
  player periodically checks the existing episode endpoint
- when the episode becomes downloaded, the player pauses, saves progress,
  reloads the same audio URL, restores the saved position, and resumes only
  after the source is ready
- polling failures do not interrupt the current stream; the next check may retry

### Icon Library

Decision:
- use Hugeicons only across the frontend

Rules:
- do not introduce additional icon libraries
- when a Hugeicons icon is used in code, prefer the Hugeicons export name directly instead of local alias renaming
- shared frontend icon choices should stay aligned with the Hugeicons names used by the matching Figma components

### Playback Speed Control

Decision:
- the player should expose these playback speed options:
  - `Speed 0.5x`
  - `Speed 0.75x`
  - `Speed 1x`
  - `Speed 1.3x`
  - `Speed 1.5x`
  - `Speed 2x`
- default playback speed is `Speed 1.3x`
- on mobile, the playback speed control opens the existing bottom sheet component; the current speed is marked and selecting an option applies it and closes the sheet
- on desktop, the playback speed control continues to use the dropdown menu

Rules:
- speed selection should be restored from backend-owned playback settings for cross-device consistency
- if no speed has been selected yet, the frontend should use `Speed 1.3x`
- backend playback progress remains stored in seconds and should not depend on the selected speed label
- do not add extra speed options unless the product decision changes

### Playback Seek Controls

Decision:
- the player seeks backward by 15 seconds
- the player seeks forward by 30 seconds

Rules:
- mobile and desktop player controls must display intervals that match the actual seek behavior
- seeking must continue to synchronize the resulting playback position with `didSeek: true`

### Playback Completion Contract

Decision:
- completion is an explicit client signal, separate from periodic progress synchronization

Rules:
- send `completed: true` only when the browser audio element reports the `ended` event
- pause, seek, unload/beacon, and periodic progress updates always send `completed: false`, including at or near the duration
- handle `nextEpisodeId` from the explicit completion response
- if completion finishes the last playlist item, backend chooses the topmost earlier unlistened playlist episode, not the nearest previous row
- if the selected fallback episode has playback state, resume from its stored position
- if it has no playback state, start from `0:00`
- ordinary progress responses must not be treated as completion and must not trigger playlist or file-side reconciliation

## Guidance For Frontend Implementation

- keep the frontend simple and maintainable
- treat the backend API as the source of truth
- keep business rules on the backend
- avoid building a large custom design system up front
- use `shadcn/ui` as the component base, then keep mpod-specific UI pieces local and focused
- keep design decisions aligned with the chosen Sitsiilia Figma library
- only Figma elements from sections marked `Ready for Development` should be included in the development process
- before implementing a component, analyze the referenced Figma layout and confirm it is development-ready
- when implementing components from Figma, follow the same discipline used when creating Figma components: use existing primitives and tokens, do not invent missing behavior or visuals, and ask when the source is unclear
- use [docs/uf.md](uf.md) and [docs/screens.md](screens.md) as the current working references for overall user flow and screen structure
