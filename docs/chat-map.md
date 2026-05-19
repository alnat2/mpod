# mpod Chat Map

This document suggests how to split project work across chats without losing source-of-truth decisions.

The goal is to keep context clean while avoiding fragmented decision-making.

## Recommended Chats

Use three main chats:

1. frontend-decisions-and-ux-ui
2. frontend-implementation
3. backend-review-and-qa

This is enough separation for the current project stage. Do not create a separate chat for every small bug, component, or styling tweak unless there is a strong reason.

## Chat 1: Frontend Decisions And UX/UI

Purpose:
- define frontend stack choices
- define app structure and route map
- define screen structure and interaction patterns
- define UX/UI direction for auth, podcasts, episodes, playlist, player, and settings
- document assumptions that affect implementation

Use this chat for:
- library evaluation
- state-management decisions
- routing decisions
- responsive layout decisions
- navigation and information architecture
- interaction design and user flow discussion

Do not use this chat for:
- broad backend redesign
- re-deciding approved API or backend behavior unless explicitly requested
- isolated implementation-only fixes

Read first:
- [README.md](/Users/cross/Documents/mpod/README.md)
- [AGENTS.md](/Users/cross/Documents/mpod/AGENTS.md)
- [docs/product-decisions.md](/Users/cross/Documents/mpod/docs/product-decisions.md)
- [docs/architecture.md](/Users/cross/Documents/mpod/docs/architecture.md)
- [docs/current-status.md](/Users/cross/Documents/mpod/docs/current-status.md)
- [docs/chat-template.md](/Users/cross/Documents/mpod/docs/chat-template.md)

Expected outputs:
- frontend stack recommendation
- UX/UI decisions
- route and screen map
- implementation guidance for the frontend chat

## Chat 2: Frontend Implementation

Purpose:
- scaffold the frontend
- implement screens and components
- connect the UI to the existing Go backend
- keep client behavior aligned with approved backend rules

Use this chat for:
- Vite and React scaffold
- component implementation
- API client wiring
- auth/session bootstrapping
- query and mutation flows
- responsive layout work
- accessibility and polish

Do not use this chat for:
- revisiting settled product behavior
- broad backend feature design
- independent QA signoff

Read first:
- [README.md](/Users/cross/Documents/mpod/README.md)
- [AGENTS.md](/Users/cross/Documents/mpod/AGENTS.md)
- [docs/product-decisions.md](/Users/cross/Documents/mpod/docs/product-decisions.md)
- [docs/architecture.md](/Users/cross/Documents/mpod/docs/architecture.md)
- [docs/current-status.md](/Users/cross/Documents/mpod/docs/current-status.md)
- [docs/chat-template.md](/Users/cross/Documents/mpod/docs/chat-template.md)
- any approved frontend decision notes produced by the frontend-decisions-and-ux-ui chat

Expected outputs:
- working frontend scaffold
- implemented screens and components
- integration with `/api`
- follow-up questions only when implementation uncovers a real product ambiguity

## Chat 3: Backend Review And QA

Purpose:
- review backend/frontend integration risks
- design and run tests
- validate behavior against the approved docs
- catch regressions and contradictions

Use this chat for:
- test planning
- code review
- bug triage
- verification against product docs
- edge-case checks
- API/UI contract checks

Do not use this chat for:
- inventing new UX flows
- doing all primary implementation work
- reopening decisions that are already documented

Read first:
- [README.md](/Users/cross/Documents/mpod/README.md)
- [AGENTS.md](/Users/cross/Documents/mpod/AGENTS.md)
- [docs/product-decisions.md](/Users/cross/Documents/mpod/docs/product-decisions.md)
- [docs/architecture.md](/Users/cross/Documents/mpod/docs/architecture.md)
- [docs/current-status.md](/Users/cross/Documents/mpod/docs/current-status.md)
- [docs/chat-template.md](/Users/cross/Documents/mpod/docs/chat-template.md)

Expected outputs:
- findings first
- gaps in test coverage
- bugs and regression risks
- verification notes for completed work

## Working Rules

- Keep behavior decisions in the frontend-decisions-and-ux-ui chat unless the docs already answer the question.
- Keep build work in the frontend-implementation chat once a decision is approved.
- Keep review and validation in the backend-review-and-qa chat.
- If a chat discovers a decision-level ambiguity, move that question back to frontend-decisions-and-ux-ui instead of resolving it ad hoc.
- If a decision becomes settled, capture it in project docs so future chats do not need to rediscover it.

## When To Create Another Chat

Create an extra chat only if one of these is true:
- the workstream is long-running and meaningfully separate
- the context is becoming noisy enough to slow down good work
- the task needs a different mindset, such as review instead of implementation

Avoid creating new chats for:
- single small bugs
- single components
- one endpoint
- one styling tweak
- routine follow-up edits

## Suggested Current Setup

For the current state of mpod:

- Use `frontend-decisions-and-ux-ui` for stack, scaffold direction, route map, and UX/UI choices.
- Use `frontend-implementation` for the React app scaffold and screen implementation.
- Use `backend-review-and-qa` for review findings, regression checks, and test coverage planning.

This should provide enough separation without turning project coordination into extra work.
