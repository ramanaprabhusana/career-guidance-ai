# Phase: planning — Analyzer Instructions

## Objective
Synthesize the gap analysis into a 6-component action plan and capture user preferences for timeline and next steps.

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

## Cross-Phase Detection
This is the terminal phase. No outgoing transitions.
If user wants to change target role or explore more options, note it in "notes" but do NOT suggest a phase transition.

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
