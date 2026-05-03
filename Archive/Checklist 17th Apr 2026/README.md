# Checklist 17th Apr 2026 — Canonical Sprint Tracker

This folder is the **single source of truth** for what's shipped, what's partial, and what's next. Older enhancement folders (`Enhancement and others 14 Apr 2026/`, `Checklist 8th April 2026/`) and the root-level `*_PLAN.md` files are superseded by these four documents.

## Files in this folder

| File | Purpose |
|---|---|
| [Checklist_claude_summary.md](Checklist_claude_summary.md) | Per-skill (1–10) status with latest rating and next step |
| [architecture_target_vs_current.md](architecture_target_vs_current.md) | Target architecture → current-state evidence, with Strong / Partial alignment |
| [project_plan_comp_checklist.md](project_plan_comp_checklist.md) | Plan-level compliance: which original objectives are Yes / Partial |
| [Gap_closure.md](Gap_closure.md) | P1 → P4 priority queue to move Partial items to Yes/Strong |

## How to use this folder

1. **Starting a new session?** Read `Checklist_claude_summary.md` first — it names the Partial skills driving the active sprint.
2. **Planning new work?** Write against `Gap_closure.md` P1 → P4 order. Do not branch into parallel priorities.
3. **Shipping a PR that closes a Partial skill?** Update all four files in this folder in the same PR so status reads consistently.
4. **Reference historical architecture or feature changelog entries?** See the root `CHANGELOG*.md` files and `CLAUDE.md §9 Change History` — those remain authoritative for what changed and when.

## Current sprint priorities (from Gap_closure.md)

- **P1** — Production-grade recovery & fallback matrix (Skill 8)
- **P2** — Reliability test gate for critical journeys (Skill 9)
- **P3** — State + rule determinism hardening (Skills 4 + 6)
- **P4** — Memory continuity robustness (Persistent memory)

## Retired / archive candidates

The following files/folders at the project root duplicate or pre-date this folder's content. They should be moved to `archive/` or deleted once we're confident nothing live references them:

- `COMPETITIVE_ENHANCEMENT_PLAN.md`
- `FEATURE_EXPANSION_PLAN.md`
- `Implementation_Plan.md`
- `REDESIGN_PLAN.md`
- `🔬 COMPLETE ENHANCEMENT CATALOG.docx` (125-item raw catalog — archive only, don't delete)
- `Enhancement and others 14 Apr 2026/` (Change 5 closeout — already captured in `CLAUDE.md §9`)
- `Checklist 8th April 2026/` (superseded by this folder)
- `project_plan_comp_checklist.md` at project root (duplicate of the one in this folder)

Archive action is tracked as a follow-up PR; do not delete inline with code changes.
