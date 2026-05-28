---
name: frontend-implementation
description: Implement mpod React frontend components and screens from Ready for Development Figma sections using shadcn/ui, Hugeicons, project docs, and strict design-to-code verification. Use when creating or updating mpod frontend code from Figma, implementing mpod-specific components, composing screens, or translating approved Figma layouts into React.
---

# mpod Frontend Implementation

Use this skill for mpod frontend code work that implements Figma-approved components or screens.

## Read First

Before implementing from Figma, read:

- `../../AGENTS.md`
- `../mpod-frontend-figma-sync/SKILL.md`
- `../../docs/frontend-decisions.md`
- `../../docs/screens.md`
- `../../docs/uf.md`
- `../../docs/product-decisions.md` when behavior or lifecycle rules are involved
- `../../frontend/.agents/skills/shadcn/SKILL.md` before using or changing shadcn components
- `../figma-library-components/SKILL.md` as the design discipline reference

## Hard Gates

- Implement only Figma elements from sections whose Figma status is `Ready for Development`.
- The status may be a Figma section status badge, not the section name. If the tool cannot read the status, use the user's screenshot or explicit confirmation; otherwise ask.
- Do not implement draft/reference sections unless the user explicitly approves that specific section.
- Do not invent behavior, variants, labels, icons, spacing, colors, or component states. If the Figma source or docs are unclear, ask before coding.
- Do not make assumptions to fill missing Figma, documentation, API, or code access. This skill is an execution checklist, not permission to guess.
- If the exact Figma file, page, frame, component, section, screenshot, or `Ready for Development` status cannot be accessed, stop and say: `I do not have access to the file/frame needed for this task.`
- If required code, docs, assets, or local files cannot be accessed, stop and say what access is missing before coding.
- If you have a design or implementation idea but the source is unavailable or ambiguous, stop and ask first: `I want to do X and Y. What do you say?`
- Never continue from memory, prior screenshots, or inferred design intent unless the user explicitly approves that fallback for the current task.
- Do not modify source UI library components. In code, shadcn-generated files under `frontend/src/components/ui/` are local project primitives and may be adjusted only to match project configuration, accessibility, or generated-component integration needs.

## Required Workflow

1. Confirm the target Figma section/component is `Ready for Development`.
2. Inspect the referenced Figma layout before writing code:
   - use `get_design_context` on the exact component/frame node
   - use `get_screenshot` when visual structure, spacing, or responsive behavior matters
   - inspect variants and related nodes individually instead of relying only on sparse section metadata
   - if a change touches a shared primitive such as `TopNav`, `PageHeader`, `AppShell`, `EpisodeRow`, `PlaylistQueue`, or `PodcastCard`, inspect both the exact screen/frame node and the exact shared component node before editing
   - do not push screen-specific measurements into shared primitives unless the shared component node itself confirms that change
   - when the change involves icons, inspect the exact icon node name used in the exact component/state node; do not infer from a nearby frame or another variant
   - when the change involves semantic colors or borders, verify the frontend token values and do not assume matching token names imply matching values
   - if any required Figma read fails or returns the wrong page/frame, stop and report the access problem instead of implementing from assumptions
3. Cross-check behavior against docs:
   - frontend decisions for UI rules
   - screens for placement and screen model
   - user flow for interaction sequence
   - product decisions for backend-owned behavior
4. Inspect the existing frontend structure and installed shadcn components:
   - `frontend/components.json`
   - `frontend/src/components/ui/`
   - existing mpod-specific components before creating new ones
5. Implement with local shadcn primitives and Hugeicons:
   - import shadcn primitives from `@/components/ui/...`
   - import Hugeicons with `HugeiconsIcon` from `@hugeicons/react` and icon data from `@hugeicons/core-free-icons`
   - do not use `lucide-react`
6. Verify:
   - run `npm run lint` in `frontend`
   - run `npm run build` in `frontend`
   - when a visual component or screen changes, start/keep the dev server and inspect the result in a real browser
   - if the change is based on a Figma frame or component, compare the browser result against that exact Figma source before calling the task complete
   - if the user flagged a visible mismatch in a screenshot, verify that exact visible instance in the browser before closing the task
   - for component-level Figma work, do not stop at “looks close”; explicitly verify:
     - visible control/button count matches
     - icon meaning and icon identity match
     - text line count, wrap/truncation, and fit match
     - left/middle/right layout zones match
     - if any one of these fails, the component is not done

## Implementation Rules

- Compose mpod components on top of shadcn primitives; do not build a new design system.
- Keep mpod-specific components outside `frontend/src/components/ui/`.
- Use semantic Tailwind/shadcn tokens such as `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, and `text-primary-foreground`.
- Do not use raw hex colors for app UI unless a documented asset or external image requires it.
- Use shadcn variants before custom styling.
- Use `gap-*` for layout spacing, not `space-x-*` or `space-y-*`.
- Use `size-*` when width and height are equal.
- Use `cn()` for conditional classes.
- Use `Tooltip` for icon-only controls whose meaning is not visible.
- Use exact user-facing labels from the docs or Figma. Do not silently rename actions.
- Keep frontend business logic thin. Backend API responses remain the source of truth.
- Do not treat approximate icon matches as acceptable unless the user explicitly approves a fallback.
- Do not treat semantic token classes as correct until the underlying frontend token values are confirmed to match the Figma/library values.

## Current Project Facts

- Frontend root: `frontend/`
- Framework: React + Vite + TypeScript
- Styling: Tailwind v4 through shadcn/ui
- shadcn config: `frontend/components.json`
- shadcn style/base: `radix-nova`, `radix`
- Icon library: `hugeicons`
- Main Figma file: `3CmMv8wYlyNz9qDDdOd2Ka`
- Current ready component section: `mpod components`, node `538:933`, with Figma status `Ready for dev`

## Component Names

Use normalized code names:

- `Logo`
- `AuthCard`
- `AuthShell`
- `TopNav`
- `PageHeader`
- `AppShell`
- `EpisodeRow`
- `PlaylistQueue`
- `PodcastCard`
- `AddPodcast`
- `FileDropzone`
- `Player`
- `SettingItem`
- `ShowNotes`
- `ModalScreen` only if it represents a reusable screen/modal composition rather than a one-off presentation frame

## Ask Before Coding When

- The Figma status is not visible or not confirmed as `Ready for Development`.
- A component exists in Figma but has no clear behavior in the docs.
- A Figma layout conflicts with product decisions or screen/user-flow docs.
- A needed shadcn primitive is not installed and adding it would affect scope.
- A Hugeicons equivalent is not obvious.
- The exact Figma icon exists conceptually but the rendered frontend instance still appears visually different after a text-level comparison.
- Semantic token names match between Figma and code, but the concrete values may be different.
- The implementation would require backend behavior not already documented.

## Done Check

Before finishing a component or screen:

- The Figma source was inspected at the specific node level.
- Exact icon identity was verified for any changed icon-bearing control.
- Frontend token values were cross-checked when a change depended on semantic colors, borders, or selected/focus states.
- The component matches the approved layout and documented behavior.
- A real browser visual check was done for Figma-based UI changes.
- The visible control/button count matches the referenced Figma component or frame.
- Text fit was checked explicitly, including real line count and truncation/wrapping behavior.
- The overall component silhouette matches, including row/card height and left/middle/right zone structure.
- shadcn primitives and Hugeicons are used correctly.
- No Lucide imports were introduced.
- No draft-only Figma section was implemented.
- `npm run lint` passes.
- `npm run build` passes.
