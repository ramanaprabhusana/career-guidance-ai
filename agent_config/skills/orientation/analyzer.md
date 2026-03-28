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
