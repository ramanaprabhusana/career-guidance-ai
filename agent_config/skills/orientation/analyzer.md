# Phase: orientation — Analyzer Instructions

## Objective
Collect the user's professional background: job title, industry, experience level, education, and session goal.

## Fields to Extract

### job_title (required)
- **What to look for:** Current or most recent professional role/position
- **Type:** string
- **Interpretation:** Normalize to standard job titles where obvious (e.g., "dev" → "Software Developer", "PM" → "Project Manager"). Keep user's phrasing if specific enough.
- **Validation:** Must be a recognizable professional role, not a company name or industry
- **Examples:**
  - User says: "I'm a marketing manager at Google" → Extract: "Marketing Manager"
  - User says: "I work in sales" → Do NOT extract (too vague, need specific title)
  - User says: "I was a senior data analyst" → Extract: "Senior Data Analyst"
- **Do NOT extract if:** User only mentions a department or company without a role

### industry (required)
- **What to look for:** The sector or industry the user works/worked in
- **Type:** string
- **Interpretation:** Use standard industry names (e.g., "tech" → "Technology", "pharma" → "Pharmaceutical")
- **Validation:** Must be an identifiable industry or sector
- **Examples:**
  - User says: "I work at a hospital" → Extract: "Healthcare"
  - User says: "I'm in fintech" → Extract: "Financial Technology"
  - User says: "I'm a teacher" → Extract: "Education"
- **Do NOT extract if:** Industry cannot be reasonably inferred

### years_experience (required)
- **What to look for:** Total years of professional work experience
- **Type:** integer
- **Interpretation:** Round to nearest integer. "a couple years" → 2, "about a decade" → 10, "fresh out of school" → 0, "just graduated" → 0
- **Validation:** Must be >= 0 and <= 50
- **Examples:**
  - User says: "I've been working for 7 years" → Extract: 7
  - User says: "I graduated last May" → Extract: 0
  - User says: "over 15 years in the field" → Extract: 15
- **Do NOT extract if:** User gives contradictory information (ask for clarification)

### education_level (required)
- **What to look for:** Highest level of formal education completed
- **Type:** enum: high_school | associate | bachelor | master | doctoral | other
- **Interpretation:** "college degree" → "bachelor", "grad school" → "master", "PhD" → "doctoral", "some college" → "other", "trade school" → "other"
- **Validation:** Must map to one of the enum values
- **Examples:**
  - User says: "I have an MBA" → Extract: "master"
  - User says: "I finished my BS in CS" → Extract: "bachelor"
  - User says: "I have a GED" → Extract: "high_school"
- **Do NOT extract if:** Ambiguous between levels (e.g., "I went to college" — could be associate or bachelor)

### session_goal (required)
- **What to look for:** Whether user wants to explore options broadly or pursue a specific role
- **Type:** enum: explore_options | pursue_specific_role
- **Interpretation:**
  - Signals for explore_options: "not sure what I want", "exploring", "what are my options", "thinking about a change", "don't know what direction"
  - Signals for pursue_specific_role: names a specific job/role, "I want to become a...", "transitioning to...", "aiming for..."
- **Examples:**
  - User says: "I'm not sure what I want to do next" → Extract: "explore_options"
  - User says: "I want to become a data scientist" → Extract: "pursue_specific_role"
  - User says: "I'm thinking about switching careers" → Extract: "explore_options", confidence: 0.7
- **Do NOT extract if:** Truly ambiguous — ask a clarifying question

### location (optional)
- **What to look for:** Where the user lives or wants to work. City, region, state, country, or "remote".
- **Type:** string
- **Interpretation:** Extract the shortest unambiguous form ("Boston", "Bay Area", "remote", "NYC metro"). Do NOT invent a location from context (e.g., company HQ).
- **Examples:**
  - User says: "I'm based in Chicago" → Extract: "Chicago"
  - User says: "I'm open to remote roles" → Extract: "remote"
  - User says: "moving to Austin next year" → Extract: "Austin"
- **Do NOT extract if:** User only mentions a country of origin without a work-location signal.

### preferred_timeline (optional)
- **What to look for:** The user's stated horizon for a career transition. Months, quarters, years, or an explicit "undecided".
- **Type:** string
- **Interpretation:** Keep the user's phrasing when short ("6 months", "1 year", "ASAP", "no rush"). Normalize obvious paraphrases ("half a year" → "6 months").
- **Examples:**
  - User says: "I'd like to make the move within a year" → Extract: "1 year"
  - User says: "no rush, maybe 2–3 years out" → Extract: "2-3 years"
  - User says: "I need something soon" → Extract: "ASAP"
- **Do NOT extract if:** The user only mentions age / how long they've been in their current role without stating a transition horizon.

### target_role (optional)
- **What to look for:** A specific role the user wants to transition to or pursue
- **Type:** string
- **Interpretation:** Extract the specific target job title if user clearly names one alongside "pursue_specific_role" intent
- **Examples:**
  - User says: "I want to become a data scientist" -> Extract: "Data Scientist"
  - User says: "I'm aiming for a product manager role" -> Extract: "Product Manager"
  - User says: "I want to switch to UX design" -> Extract: "UX Designer"
- **Do NOT extract if:** User only says they want to explore options without naming a specific role

## Cross-Phase Detection
If user mentions a specific target role with conviction:
- Extract session_goal as "pursue_specific_role"
- Extract target_role with the specific role name
- Set phase_suggestion to "exploration_role_targeting" if all 5 required fields are complete

## Cross-cutting Intents (Change 4)
In addition to phase-specific fields, watch for these global intents and add them to `extracted_fields` whenever the user signals them:

- **restart_intent** (boolean): The user wants to discard the current path and try a new one. Triggers: "start over", "reset", "different direction", "forget that", "try something else".
- **continue_intent** (boolean): The user explicitly wants to resume the prior session. Triggers: "pick up where we left off", "continue last time", "where were we", "resume".
- **role_switch_intent** ({ from?: string, to: string } | null): The user wants to pivot from one target role to another. Triggers: "what about X", "actually I'm thinking about Y", "let's switch to Z", "instead of X, look at Y". When set, also mirror the new role into `target_role`.
- **role_comparison_intent** ({ roles: string[] } | null): The user wants to compare roles side by side. Triggers: "compare X and Y", "which is better, A or B", "X vs Y". Include the 2 role names in `roles`.
- **too_broad_signal** (boolean): The user is naming more than 3 industries or more than 2 roles in a single message.

## Persona Detection
Claude should add a `notes` entry of the form `PERSONA: <persona>` whenever one of these is clearly signaled:

- `PERSONA: returning_continue` — user said something like "I'm back", "let's continue", "pick up where we left off", "resume my session"
- `PERSONA: returning_restart` — user said "start over but keep my info", "new direction but same me", "reset the path but keep my background"
- `PERSONA: new_user` — first-time user with no prior session context

Persona detection does NOT replace the `session_goal` field — both are emitted in parallel so the orchestrator can route.

## Edge Cases
- If user provides all 5 fields in a single message, extract all and set required_complete: true
- If user provides job title and industry together (common), extract both
- If user says "I'm between jobs" → Extract job_title as their most recent role if mentioned

## Completion
Set `required_complete: true` ONLY when ALL of these have non-null values:
- job_title
- industry
- years_experience
- education_level
- session_goal
