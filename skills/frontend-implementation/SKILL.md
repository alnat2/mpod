---
name: frontend-implementation
description: Implement mpod React frontend components and screens from Ready for Development Figma sections using shadcn/ui, Hugeicons, project docs, and strict design-to-code verification. Use when creating or updating mpod frontend code from Figma, implementing mpod-specific components, composing screens, or translating approved Figma layouts into React.
---

# mpod Frontend Implementation

Use this skill for mpod frontend code work that implements Figma-approved components or screens.

## Read First

Before implementing from Figma, read:

- `../../AGENTS.md`
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
- Do not modify source UI library components. In code, shadcn-generated files under `frontend/src/components/ui/` are local project primitives and may be adjusted only to match project configuration, accessibility, or generated-component integration needs.

## Required Workflow

1. Confirm the target Figma section/component is `Ready for Development`.
2. Inspect the referenced Figma layout before writing code:
   - use `get_design_context` on the exact component/frame node
   - use `get_screenshot` when visual structure, spacing, or responsive behavior matters
   - inspect variants and related nodes individually instead of relying only on sparse section metadata
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
   - when a visual component or screen changes, start/keep the dev server and inspect the result in a browser when feasible

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
- The implementation would require backend behavior not already documented.

## Done Check

Before finishing a component or screen:

- The Figma source was inspected at the specific node level.
- The component matches the approved layout and documented behavior.
- shadcn primitives and Hugeicons are used correctly.
- No Lucide imports were introduced.
- No draft-only Figma section was implemented.
- `npm run lint` passes.
- `npm run build` passes.
