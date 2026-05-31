# Frontend Beta QA

Use this checklist before a beta push and after any high-risk frontend change.

## Automated

- `npm run test`
- `npm run test:e2e`
- `npm run lint`
- `npm run build`

## Auth

- Open `/login`
- Log in with a valid account
- Confirm redirect to `/subscriptions`
- Confirm invalid credentials show a clear inline error

## Subscriptions

- Empty state shows `Add RSS feed` and `Import OPML`
- Add one RSS feed and confirm the podcast card appears
- Open one episode row and verify action order:
  - `Download` / `Downloaded`
  - `Add to playlist` / `Remove from playlist`
  - `Show notes`
  - `Mark as listened` / `Mark as unlistened`
- Open `Show notes` and confirm the modal opens and closes
- Use `Mark all listened` and confirm affected unlistened rows update immediately without an undo banner
- Use podcast `Unsubscribe` and confirm the undo banner appears with a 15-second countdown

## Home / Playback

- Open `/home`
- Confirm the large player reflects the actual active episode
- Click `Play` on a non-top playlist row and confirm:
  - the row stays in place
  - the player switches to that episode
  - playback starts
- Drag playlist items and confirm the new order persists after reload
- Click the progress bar to seek
- Change playback speed and confirm the menu label matches playback behavior

## Settings

- Save a new daily refresh time
- Reload the page and confirm the saved time remains
- If proxy runtime config exists, toggle proxy and confirm the switch persists
- Confirm scheduler status updates after `Refresh all`

## Responsive

- Check `/subscriptions`, `/home`, and `/settings` at a narrow mobile-width viewport
- Confirm rows do not collapse, text does not overlap, and banners remain readable

## Regression Focus

- Playback startup after reload
- Downloaded icon state
- Undo banners fixed at `100px` from top and out of flow
- Error banners dismiss correctly
