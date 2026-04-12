# Phase: exploration_career — Analyzer Instructions

## Objective
Discover the user's interests, constraints, and surface 2-4 candidate career directions based on their profile and preferences.

## Fields to Extract

### interests (optional, append)
- **What to look for:** Topics, fields, activities, or work types the user finds engaging
- **Type:** string[]
- **Interpretation:** Capture distinct interests as separate items. "I like data and design" → ["data analysis", "design"]
- **Examples:**
  - User says: "I've always been interested in AI" → Append: "artificial intelligence"
  - User says: "I enjoy working with people and solving problems" → Append: ["interpersonal work", "problem solving"]
- **Do NOT extract if:** User is describing past duties, not interests

### constraints (optional, append)
- **What to look for:** Location, schedule, compensation, or lifestyle constraints
- **Type:** string[]
- **Examples:**
  - User says: "I need to stay in the Midwest" → Append: "location: Midwest"
  - User says: "I can't take a pay cut" → Append: "compensation: no pay reduction"
  - User says: "I need flexible hours for my family" → Append: "schedule: flexible hours"
- **Do NOT extract if:** User mentions protected characteristics as constraints

### candidate_directions (optional, append)
- **What to look for:** When the system or user identifies potential career paths
- **Type:** object[] with direction_title and rationale
- **Examples:**
  - When enough interests are gathered, the system generates directions
  - User says: "What about product management?" → Append: {"direction_title": "Product Management", "rationale": "User-initiated interest"}
- **Do NOT extract if:** User is asking about a direction hypothetically without indicating interest

### candidate_industries (optional, append) — Change 4 (BR-11)
- **What to look for:** Distinct industries or sectors the user is considering. This is SEPARATE from `interests` (which are activities/topics) and SEPARATE from `candidate_directions` (which are specific roles).
- **Type:** string[]
- **Hard cap:** The backend reducer caps at 3. If the user names a 4th, the backend raises an `INDUSTRY_CAP_HIT` signal — still extract all 4 so the signal fires; the reducer will truncate.
- **Examples:**
  - User says: "I'm thinking about tech, healthcare, or consulting" → Extract: ["Technology", "Healthcare", "Consulting"]
  - User says: "I'd also consider nonprofits" → Append: ["Nonprofit"]
- **Do NOT extract if:** User only mentions a specific role/company (those are directions, not industries).

### Cross-cutting intents (shared with orientation analyzer)
Also emit when clearly signaled:
- `too_broad_signal` (boolean): true when the user names >3 industries or >2 roles in a single message
- `role_switch_intent`, `role_comparison_intent`, `restart_intent`, `continue_intent` — see orientation analyzer for trigger phrases

## Cross-Phase Detection
If user names a specific target role with conviction:
- Set phase_suggestion to "exploration_role_targeting"
- Extract the role name for the target_role field in the next phase
- Examples:
  - "I actually want to become a UX designer" → phase_suggestion: "exploration_role_targeting"
  - "Maybe something in management?" → Do NOT transition (too vague)

## Edge Cases
- If user expresses interest in something that conflicts with their constraints, note it but extract both
- If user seems overwhelmed by options, note in "notes" field for speaker to narrow down
- If the user names more than 3 candidate industries in total (counting prior turns), set `notes` to include "INDUSTRY_CAP_HIT" so the speaker can help them narrow.

## Completion
This phase does not have strict required_complete criteria. Signal readiness when:
- At least 2 candidate_directions have been identified
- User has expressed readiness to move forward or narrow down
