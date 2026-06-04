# Storybook Handoff

## Goal
Set up Storybook for `mpod` so component development happens locally on the MacBook, while NAS serves only the static Storybook build.

## Coordination Rules
- This file is the shared handoff between the frontend chat and the infra chat.
- Update only your own section unless you are recording a shared decision.
- Keep entries short and current.
- Prefer appending facts over rewriting history.
- If a decision changes, update `Decisions` and note the date.

## Decisions
- 2026-05-24: Storybook development runs locally on the MacBook.
- 2026-05-24: NAS will serve only the static Storybook build output.
- 2026-05-24: Coordination between chats happens through this file.
- 2026-05-24: Infra will publish static Storybook files from `/home/cross/mpod-storybook/storybook-static` on NAS.
- 2026-05-24: Initial static hosting target on NAS uses Docker Compose with `nginx` on port `6006`.

## Frontend
- owner: mpod frontend chat
- status: ready_for_infra
- done:
  - added Storybook to `frontend/` for the current React + Vite stack
  - added npm scripts:
    - `npm run storybook`
    - `npm run build-storybook`
  - created base config in `frontend/.storybook/`
  - added first stories for shared UI components and `mpod` components
  - added global Storybook decorators for `MemoryRouter`, `TooltipProvider`, and app CSS
  - confirmed local Storybook dev server starts on port `6006`
  - confirmed static Storybook build succeeds
  - confirmed static output directory is `frontend/storybook-static`
  - fixed shrink-to-fit canvas issues for width-constrained stories by adding explicit story wrappers for `AuthCard`, `AddPodcast`, `FileDropzone`, `Player`, and `ShowNotes`
  - configured the built-in Storybook 10 viewport for `mpod/mobile/*` stories so Tailwind responsive variants use a real `360px × 800px` iframe viewport instead of the manager window width
  - added shared mobile viewport helpers in `frontend/src/components/mpod/storybook-viewport.ts`
  - visually verified the updated stories in Chromium against the built Storybook output
- next:
  - expand stories to additional screen-level compositions only where they provide clear value beyond component stories
  - add richer mocked states for backend-driven screens if frontend development starts depending on them
- blocked:
  - none
- notes:
  - Use mocks or decorators for API, router, playback context, and any other runtime dependencies that should not require the backend during Storybook development.
  - Standard local package manager: `npm`
  - Local dev command: `cd frontend && npm run storybook`
  - Static build command: `cd frontend && npm run build-storybook`
  - Static build output: `frontend/storybook-static`
  - Mobile stories use the `mpodMobile` viewport through story `globals`; keep this in place for every `mpod/mobile/*` story because wrapper width alone does not stop Tailwind `md:` classes from matching the Storybook iframe viewport.
  - Storybook 10 includes viewport support in the core `storybook` package; do not add `@storybook/addon-viewport` unless Storybook packaging changes, because no matching `10.x` addon package is currently published.
  - No custom Storybook base path is configured in the first pass; static hosting should serve the build at site root for its host/port.
  - Router-dependent stories use `MemoryRouter` in a global decorator, so Storybook does not require the app router or a backend session.
  - App CSS is loaded from `frontend/src/index.css`; static assets are bundled by Vite/Storybook from normal imports, with no separate asset sync step needed beyond copying `storybook-static`.
  - Infra should publish the contents of `frontend/storybook-static` to NAS and serve that directory as static files.

## Infra
- owner: adm infra chat
- status: ready_for_validation
- done:
  - confirmed the preferred architecture is local Storybook development plus static hosting on NAS
  - confirmed NAS has Docker Compose and `rsync` available for static hosting and deployment
  - created NAS project directory `/home/cross/mpod-storybook`
  - created NAS Compose file `/home/cross/mpod-storybook/compose.yml`
  - created NAS nginx config `/home/cross/mpod-storybook/nginx/default.conf`
  - created placeholder static site in `/home/cross/mpod-storybook/storybook-static`
  - started the `mpod-storybook` container on NAS with port mapping `6006:80`
  - created local deploy helper `/Users/cross/Documents/adm/scripts/deploy-mpod-storybook.sh`
  - published the current local `frontend/storybook-static` build to NAS
  - verified on NAS that `http://127.0.0.1:6006/` serves real Storybook HTML and metadata
- next:
  - decide whether direct port `6006` is enough or whether Storybook should later sit behind an existing reverse proxy
  - optionally add a more structured release flow or backup strategy for future publishes
- blocked:
  - direct LAN reachability of `192.168.0.222:6006` could not be confirmed from this Codex environment, although the site responds on NAS itself via `http://127.0.0.1:6006`
- notes:
  - Current publish target on NAS: `/home/cross/mpod-storybook/storybook-static`
  - Current service path on NAS: `/home/cross/mpod-storybook/compose.yml`
  - Current local deploy helper syncs local Storybook output to NAS with `rsync` and then runs `docker compose up -d`
  - Expected default Storybook output is likely `frontend/storybook-static`, but frontend chat should confirm the actual path
  - Avoid coupling NAS hosting to local development mode.

## Open Questions
- What exact local package manager and Storybook scripts will the frontend chat standardize on?
- Will Storybook remain on its own port, or later move behind an existing reverse proxy on NAS?
- Should deployment copy only `storybook-static`, or also keep a versioned backup on NAS?

## Latest Handoff
- 2026-05-24: File created to coordinate Storybook frontend work in `mpod` and static hosting work on NAS.
- 2026-05-24: Infra prepared a first NAS hosting target at `/home/cross/mpod-storybook` with `nginx` on port `6006`, plus a local deploy helper script.
- 2026-05-24: Infra published the first real Storybook static build to NAS and verified it locally on NAS at `http://127.0.0.1:6006/`.
