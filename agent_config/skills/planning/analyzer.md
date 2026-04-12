# Phase: planning — Analyzer Instructions

## Objective
Synthesize the gap analysis into a 6-component action plan and capture user preferences for timeline and next steps.

## Prerequisites (BINDING)
Before extracting any planning fields, verify that these upstream conditions are met:
- skills array has 100% non-null user_rating values (ALL skills must be rated)
- user_confirmed_evaluation is true (user confirmed the gap summary)
- learning_needs_complete is true (learning priorities and timeframe discussed)

If prerequisites are NOT met, set `required_complete: false` and add to "notes" which prerequisites are missing (e.g., "BLOCKED: skills assessment incomplete, 3/8 skills rated"). Do NOT extract planning fields until prerequisites are satisfied.

## Fields to Extract

### timeline (required)
- **What to look for:** User's preferred or realistic timeline for career transition
- **Type:** string
- **Interpretation:** Accept ranges ("6-12 months"), specific durations ("1 year"), or qualitative ("as soon as possible")
- **Examples:**
  - User says: "I'd like to make the switch within a year" → Extract: "12 months"
  - User says: "I'm not in a rush, maybe 2 years" → Extract: "24 months"
  - User says: "As quickly as possible" → Extract: "as soon as possible"
- **Do NOT extract if:** User hasn't expressed any timeline preference

### recommended_path (derived)
- **What to look for:** This is SYSTEM-GENERATED based on gap analysis, not user input
- **Do NOT extract from user messages**

### skill_development_agenda (derived)
- **What to look for:** This is SYSTEM-GENERATED based on skill gaps
- **Do NOT extract from user messages**

### immediate_next_steps (derived)
- **What to look for:** This is SYSTEM-GENERATED — 2-3 concrete actions
- **Do NOT extract from user messages**

### plan_rationale (derived)
- **What to look for:** This is SYSTEM-GENERATED
- **Do NOT extract from user messages**

### report_generated (system)
- Set to true when PDF/HTML export is triggered
- **Do NOT extract from user messages**

### learning_resources (optional, high value)
- **What to look for:** When the user asks for courses, tutorials, or links, or when you finalize the plan, propose **3 to 6** reputable learning resources.
- **Type:** array of objects: `{ "title": string, "url": string, "note": string (optional) }`
- **Rules:** Only include **real, well-known** platforms (e.g. Coursera, edX, freeCodeCamp, MDN, Khan Academy, official vendor docs). Use **https** URLs you are confident exist, or omit the item.
- If unsure of a URL, put the platform name in `note` and use the organization's **homepage** URL only.

### evidence_kept (optional)
- Log **1 to 4** structured entries for facts or data you are **using** in the plan (e.g. O*NET skill gaps, user-stated goals, BLS wage band if discussed).
- **Type:** array of `{ "source": string, "detail": string, "reason": string }`
- Example source values: `O*NET`, `BLS`, `user_input`, `session_summary`

### evidence_discarded (optional)
- Log **0 to 3** entries for information you **did not** rely on (e.g. vague rumors, unverifiable salary claims, off-topic suggestions) and **why**.
- **Type:** same shape as `evidence_kept`

## Cross-Phase Detection
This is the terminal phase. Normally there are no outgoing transitions.

### Role Switch Intent (Change 4 — BR-9, BINDING)
A user IS allowed to pivot to a different target role at any point during planning. When this happens, BR-9 requires the orchestrator to rehydrate prior skill ratings and present a delta plan. You MUST surface the pivot so the state-updater can trigger that logic.

**Trigger phrases:** "actually let's look at X", "what about X instead", "I've been reconsidering... X", "let's switch to X", "I'd rather pursue X", "can we look at X instead".

**When detected:**
- Set `extracted_fields.target_role` to the new role the user named (this is what triggers `mergeRoleTargetingFields` pivot detection at `state-updater.ts`)
- Set `extracted_fields.role_switch_intent = { to: "<new role>" }`
- Set `phase_suggestion = "exploration_role_targeting"` — the orchestrator needs to walk the user back through the role-targeting phase for the new role (rehydrated ratings + delta-only questions)
- Add `"ROLE_SWITCH: <prior role> -> <new role>"` to `notes`
- Do NOT extract any planning fields (`timeline`, `learning_resources`, etc.) on the pivot turn — they belong to the OLD plan

### Role Comparison Intent (Change 4 — BR-10)
If the user asks to compare two roles ("compare X vs Y", "which is better, X or Y"), set `role_comparison_intent = { roles: [X, Y] }` and add `"ROLE_COMPARE: X vs Y"` to `notes`. Cap at exactly 2 roles.

### Other pivots
If the user wants to explore more options (not a specific role pivot), note it in `notes` but do NOT change phase.

## Edge Cases
- If user requests modifications to the plan: note specific change requests in "notes"
- If user asks to export/download: note in "notes" for speaker to offer export
- If user asks about a skill not in their assessment: note for speaker to address

## Completion
This phase completes when:
- The plan has been presented to the user
- User has acknowledged or accepted the plan
- report_generated is true (after export)
Set required_complete: true when user signals satisfaction with the plan.
