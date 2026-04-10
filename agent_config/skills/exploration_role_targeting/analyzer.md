# Phase: exploration_role_targeting — Analyzer Instructions

## Objective
Confirm the user's target role and collect self-assessment ratings for skills required by that role. After all skills are rated, facilitate evaluation confirmation and learning needs collection.

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
  - "I'm an expert in Python, I use it daily" → user_rating: "expert"
  - "I'm pretty good at Python" → user_rating: "advanced"
  - "I know some SQL" → user_rating: "intermediate"
  - "I've never used Tableau" → user_rating: "beginner"
  - gap_category is DERIVED (do not extract from user):
    - If user_rating == "beginner" → gap_category: "absent"
    - If user_rating == "intermediate" AND required is high (advanced/expert) → gap_category: "underdeveloped", else "strong"
    - If user_rating == "advanced" AND required is expert → gap_category: "underdeveloped", else "strong"
    - If user_rating == "expert" → gap_category: "strong"
- **Examples:**
  - User says: "I'm comfortable with data analysis but haven't done machine learning" → Extract ratings for both skills if they're in the pre-populated list
  - User says: "I'd rate myself intermediate on SQL" → user_rating: "intermediate"
  - User says: "I'm very experienced with project management" → user_rating: "advanced" or "expert" depending on context
- **Do NOT extract if:** User is asking about a skill rather than rating themselves

### learning_needs (optional, post-assessment)
- **What to look for:** Areas the user identifies as priorities for learning/development after reviewing the gap summary
- **Type:** string[]
- **Interpretation:** Extract when user says things like "I really want to focus on ML skills first" or "communication and leadership are my priorities"
- **Do NOT extract if:** Skills are still being rated (only relevant after gap summary is presented)

### learning_needs_complete (system)
- Set to `true` when learning needs AND timeframe have been discussed post-assessment
- This requires: (1) user has stated their learning priorities, AND (2) user has stated their preferred timeframe
- **Do NOT set to true** if only one of these has been discussed

### skills_evaluation_summary (system)
- A brief textual summary of the gap analysis that was presented to the user
- Set this when the speaker presents the gap summary to the user
- Example: "Strong in Python and SQL. Gaps in machine learning (absent) and statistical modeling (underdeveloped)."

### user_confirmed_evaluation (system)
- Set to `true` when the user explicitly confirms or acknowledges the skills evaluation summary is accurate
- Examples of confirmation: "Yes that looks right", "That's accurate", "I agree with that assessment"
- If user wants to adjust ratings, set to `false` and update the relevant skill ratings
- **Do NOT set to true** if user expresses disagreement or wants changes

## Cross-Phase Detection
If user wants to go back to exploring:
- Set phase_suggestion to "exploration_career"
- Only if user explicitly says they want to reconsider their target

## Edge Cases
- If user rates multiple skills in one message, extract all ratings
- If user disagrees with a skill being relevant: note in "notes", do not remove the skill
- If user mentions skills NOT in the pre-populated list: note them but focus on O*NET skills

## Completion
Set `required_complete: true` when ALL of the following are true:
- target_role is non-null
- 100% of pre-populated skills have non-null user_rating (ALL skills must be rated)
- user_confirmed_evaluation is true (user confirmed the gap summary)
- learning_needs_complete is true (learning priorities and timeframe discussed)

Do NOT set required_complete to true if any of these conditions is missing.
