# Phase: exploration_role_targeting — Analyzer Instructions

## Objective
Confirm the user's target role and collect self-assessment ratings for skills required by that role.

## Fields to Extract

### target_role (required)
- **What to look for:** The specific job role the user wants to pursue
- **Type:** string
- **Interpretation:** Normalize to standard job titles. "data scientist" → "Data Scientist"
- **Validation:** Must be a recognizable professional role
- **Examples:**
  - User says: "I want to become a product manager" → Extract: "Product Manager"
  - User says: "I'm interested in UX" → Do NOT extract (too broad, needs clarification)
  - User says: "I want to transition into data science" → Extract: "Data Scientist"
- **Do NOT extract if:** User is still exploring broadly without commitment

### skills (required, entity-bearing, append)
- **What to look for:** User's self-assessment of specific skills
- **Type:** object[] with per-entity fields: skill_name, onet_source, required_proficiency, user_rating, gap_category
- **Interpretation:**
  - NOTE: skill_name, onet_source, and required_proficiency are PRE-POPULATED by RAG retrieval. Only user_rating needs extraction from user messages.
  - "I'm pretty good at Python" → user_rating: "strong_proficiency"
  - "I've never used Tableau" → user_rating: "not_yet_familiar"
  - "I know some SQL" → user_rating: "working_knowledge"
  - gap_category is DERIVED (do not extract from user):
    - If user_rating == "not_yet_familiar" → gap_category: "absent"
    - If user_rating == "working_knowledge" AND required is high → gap_category: "underdeveloped"
    - If user_rating == "strong_proficiency" → gap_category: "strong"
- **Examples:**
  - User says: "I'm comfortable with data analysis but haven't done machine learning" → Extract ratings for both skills if they're in the pre-populated list
  - User says: "I'd rate myself intermediate on SQL" → user_rating: "working_knowledge"
- **Do NOT extract if:** User is asking about a skill rather than rating themselves

## Cross-Phase Detection
If user wants to go back to exploring:
- Set phase_suggestion to "exploration_career"
- Only if user explicitly says they want to reconsider their target

## Edge Cases
- If user rates multiple skills in one message, extract all ratings
- If user disagrees with a skill being relevant: note in "notes", do not remove the skill
- If user mentions skills NOT in the pre-populated list: note them but focus on O*NET skills

## Completion
Set `required_complete: true` when:
- target_role is non-null
- At least 60% of pre-populated skills have non-null user_rating
