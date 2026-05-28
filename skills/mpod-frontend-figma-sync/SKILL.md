---
name: mpod-frontend-figma-sync
description: Prevent Figma-to-frontend drift in mpod by enforcing exact-node verification, shared-component precedence, and explicit screen-vs-component sizing rules before changing React UI code.
---

# mpod Frontend Figma Sync

Use this skill whenever mpod frontend code is being changed from Figma, especially when the work touches shared layout primitives like `TopNav`, `PageHeader`, `AppShell`, `EpisodeRow`, `PlaylistQueue`, or `PodcastCard`.

## Goal

Stop accidental drift between:
- shared component specs in Figma
- individual screen/frame compositions in Figma
- frontend code that reuses those primitives
- rendered frontend output that may still diverge visually even when names look aligned

## Non-Negotiable Rule

Never change a shared frontend primitive from a screen frame alone.

If a change touches a shared component, inspect:
1. the exact screen/frame node
2. the exact shared component node

Then apply this rule:
- shared component internals come from the shared component node
- screen composition comes from the screen/frame node
- if they seem to conflict, do not guess; explain the conflict and ask before changing behavior beyond the verified source

Never treat semantic name alignment as proof of visual alignment.

Examples:
- same icon family does not guarantee the same icon
- same token name does not guarantee the same token value
- same component name does not guarantee the same rendered instance or state

## Read First

- `../../AGENTS.md`
- `../frontend-implementation/SKILL.md`
- `../../docs/frontend-decisions.md`
- `../../docs/screens.md`
- `../../docs/uf.md`

## Required Workflow

1. Confirm the exact Figma node for the requested screen or component.
2. If the change touches a shared primitive, inspect both:
   - the exact screen/frame node
   - the exact component node
3. Prefer `get_design_context`; use `get_metadata` for structure/size confirmation when needed.
4. Record the exact node ids used for the decision.
5. Classify the change before editing:
   - `shared component`
   - `screen composition`
   - `screen-local override`
6. For any icon, token, or state-sensitive visual element involved in the change, verify exact identity:
   - icons: inspect the exact Figma node name and compare it to the exact frontend icon import actually rendered
   - tokens: verify both semantic token name and concrete value; do not assume matching names mean matching values
   - states: verify the exact variant/state node, not just the component set or a nearby frame
7. If the user points to a visible rendered mismatch, treat that exact visible instance as unresolved until it is inspected directly in Figma and in the browser.
7a. For component-level mismatches, verify structure before styling:
   - count visible controls/buttons
   - verify which controls exist and which do not
   - verify text line count, wrap/truncation, and fit
   - verify left/middle/right layout zones and overall silhouette
   - if these do not match, do not describe the component as synced even if colors, borders, or spacing look close
8. Apply sizing/layout rules:
   - `TopNav`, `AppShell`, `PageHeader`, and other shared primitives follow their component nodes
   - screen-only wrappers, spacing between sections, and local composition follow the exact screen node
   - do not push screen-specific width decisions into shared primitives unless the component node itself changed
9. Only then edit code.
10. Verify with:
   - `npm run test`
   - `npm run build`
   - a real browser screenshot or live browser check against the exact referenced Figma frame/component

## Visual Verification Rule

For frontend UI created or changed from Figma:
- do not stop at code inspection, `test`, or `build`
- do a real browser visual check after the change
- compare the rendered result against the exact referenced Figma frame/component before calling the task complete
- if the user highlighted a specific icon/control/row/card in a screenshot, compare that exact visible target rather than declaring the broader component synced
- treat a mismatch in control count, icon count, text fit, or silhouette as a hard failure, not a minor polish issue

## Icon Verification Rule

When syncing icons from Figma to frontend:
- compare by exact icon identity, not by approximate shape or family
- treat the Figma node name as source of truth only after confirming it is the exact node used in the relevant component/state
- then verify the exact frontend import and the rendered browser result
- do not declare icons synced from text inspection alone when a real browser check is possible

## Token Verification Rule

When syncing semantic colors or borders from Figma:
- compare semantic token names first
- then compare the actual concrete values in the frontend theme
- if `Figma token name == frontend token name` but values differ, report token drift explicitly
- do not rely on semantic classes such as `border-ring` or `bg-primary` until the corresponding frontend token values are confirmed to match Figma

## Width and Layout Discipline

When the user calls out sizing or alignment:
- do not reuse a width discovered on one screen for all screens
- do not widen a shared wrapper because one screen has a larger outer frame
- distinguish carefully between:
  - full frame width
  - shell/content surface width
  - centered inner wrapper width
  - section-local content width

## Final Response Rule

When a Figma-based frontend change is finished, state:
- which node(s) were used
- whether the fix was for a shared component or a screen composition
- whether icon identity and token values were visually verified where relevant
