# 00 — Project Constraints & Engagement Scope

_Last updated: 2026-08-17 — Phase: **Audit only**_

## What this project is

A careful, incremental **repair and improvement** project for the existing Jess Bakes Sourdough website. This is explicitly **not** a redesign or rewrite from scratch. The public-facing site's look, personality, and content are to be preserved; the admin dashboard is the part that needs real work.

## Hard constraints (apply to every phase, not just this one)

1. **Preserve the existing logo exactly.** No new logo.
2. **Preserve all existing graphics/image assets** (`images/*.png`, including the "dino" mascot icons used across the admin dashboard).
3. **Preserve the recognizable style and personality of the public-facing website.** No new illustrations, no generated graphics, no new design system for the public pages.
4. The owner **generally likes the existing public-facing homepage** as-is.
5. Restrained public-facing improvements (spacing, typography, hierarchy, consistency, responsiveness, polish) may be **suggested** in a later phase — not implemented now.
6. **No public-facing design changes during this audit.**
7. The **admin dashboard** needs a major overhaul in organization, appearance, usability, and functionality — that is the primary target of the eventual rebuild.

## This phase's rules

- **Audit only.** No application source code, formulas, database schemas, stylesheets, components, dependencies, configuration, or existing content may be modified.
- **No CSS may be deleted**, even if it looks unused — some classes may be applied dynamically (confirmed true in this codebase: several admin modals are built and class-toggled entirely from JavaScript).
- Documentation may **only** be created inside `docs/bakery-rebuild/`.
- Branch discipline: all work happens on `rebuild/bakery-admin`. `main` is never touched, merged into, or deployed from this branch.
- Read-only diagnostics (existing build/lint/type-check/test commands, or safe syntax checks) are allowed. **No dependency installs, removals, or upgrades** without explicit approval.
- Where the code contains **conflicting business rules**, this audit documents the conflict and asks the owner which behavior is correct — it does not guess.

## Deliverables of this phase

| File | Purpose |
|---|---|
| `00-project-constraints.md` | This file |
| `01-architecture-and-data-flow.md` | Stack, hosting, every page, and how data moves end to end |
| `02-calculation-audit.md` | Every cost/price/margin/analytics calculation, where it lives, and where it disagrees with itself |
| `03-bug-register.md` | Structured findings: problem, file/function, severity, confidence, dependencies, repair phase |
| `04-admin-ux-audit.md` | Navigation, layout, forms, tables, states, accessibility, mobile |
| `05-css-audit.md` | Duplication, override chains, dead-end-of-file rules, specificity issues |
| `06-testing-gaps.md` | What exists (nothing automated), what's missing, and the diagnostics that were run |
| `07-phased-implementation-plan.md` | Recommended, safest order of repair — not yet executed |

No fixes were applied while producing these documents. See the root of this conversation's final summary for open questions that need the owner's decision before any repair work begins.
