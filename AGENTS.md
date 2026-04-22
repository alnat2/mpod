# AGENTS.md

This file defines project-specific guidance for coding agents working in this repository.

## Project Context

mpod is a single-user personal web application for podcast management.

Primary capabilities:
- one-time initial registration for the only user
- username/password login with session-based auth
- podcast subscription by RSS URL
- OPML import/export
- episode storage and download
- playlist management
- audio playback with synced resume across devices
- daily scheduled podcast refresh

Primary references:
- Product requirements: [prd.md](/Users/cross/Documents/mpod/prd.md)
- Product decisions: [docs/product-decisions.md](/Users/cross/Documents/mpod/docs/product-decisions.md)
- Architecture: [docs/architecture.md](/Users/cross/Documents/mpod/docs/architecture.md)

If this file conflicts with those documents, follow:
1. `docs/product-decisions.md`
2. `docs/architecture.md`
3. `prd.md`
4. `AGENTS.md`

## Working Principles

- Keep the implementation simple.
- Prefer boring, maintainable solutions over clever abstractions.
- Do not introduce multi-user assumptions.
- Do not introduce cloud or distributed infrastructure.
- Keep the MVP aligned with the approved docs.
- Avoid speculative features unless explicitly requested.

## Product Constraints

- The app is single-user only.
- Registration is allowed only once, when no user exists yet.
- Authentication is session-based.
- SQLite is the only database for MVP.
- Downloaded files are local disposable copies, not archival media.
- Removing an episode from playlist deletes its local file by default.
- Marking an episode as listened deletes its local file by default.
- Scheduler runs once per day at a single global configured time.
- The app listens on port `5050`.

## Architecture Constraints

- Prefer clear separation between frontend, backend, database, and file storage concerns.
- Keep business rules on the backend.
- Treat the backend as the source of truth for auth, playback, feed import, playlist, and file lifecycle behavior.
- Reuse the same refresh/import logic for manual refresh and scheduled refresh.
- Centralize file operations rather than scattering direct filesystem writes and deletes.
- Keep runtime configuration in environment variables and user-editable behavior in database-backed settings.

## Implementation Preferences

- Backend language is Go.
- Keep modules focused by responsibility.
- Prefer explicit service/repository boundaries over large mixed files.
- Avoid premature plugin systems or generic frameworks inside the app.
- Avoid over-engineering around scale that does not exist in this project.
- Prefer explicit code paths over heavy indirection.
- Add small comments only when they clarify non-obvious behavior.

## API Guidance

- Keep the API under `/api`.
- Use JSON for normal request/response bodies.
- Keep the API minimal and unpaginated unless requirements change.
- Use consistent error responses.
- Do not add advanced filtering, pagination, or search by default.

## Data and Sync Guidance

- Episode duplicate handling must follow the product decision doc.
- Playback sync rules must follow the product decision doc exactly unless changed intentionally.
- Do not overwrite user state like listened status, playlist state, or playback progress during feed refresh.
- Treat missing local files as a state reconciliation problem, not silent corruption.

## Docker and Runtime Guidance

- Use one app container for MVP.
- Use one persistent data volume mounted at `/data`.
- Default paths:
  - DB: `/data/mpod.sqlite`
  - downloads: `/data/downloads`
- Default app port: `5050`

## What To Avoid

- Do not add public registration.
- Do not add multiple users, roles, teams, or ownership models.
- Do not add Postgres, Redis, queues, or external workers unless explicitly requested.
- Do not add cloud file storage.
- Do not add API versioning unless a real need appears.
- Do not invent behavior that contradicts `docs/product-decisions.md`.

## Expected Early Deliverables

When scaffolding or implementing the project, the likely early priorities are:
- Dockerfile
- `docker-compose.yml`
- `.env.example`
- backend scaffold
- frontend scaffold
- database schema and migration setup
- initial auth flow
- podcast/feed import flow

## Definition Of Done

A task is not complete unless:
- behavior matches the approved docs
- edge cases relevant to the change are handled
- local configuration assumptions are explicit
- new files and modules fit the architecture direction
- obvious regressions or contradictions are avoided

## When Docs Are Missing

If a requirement is ambiguous:
- check `docs/product-decisions.md` first
- then check `docs/architecture.md`
- then check `prd.md`
- if still unresolved, choose the simplest option consistent with the existing documents
- document the assumption clearly in the change summary
