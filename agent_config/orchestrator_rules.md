# Orchestrator Rules: Career Guidance Assistant

## Transition Confidence
Do not transition between phases unless the Analyzer's confidence is at least 0.8.

## Default Phase Flow
- After orientation → go to exploration_career OR exploration_role_targeting (based on session_goal)
- After exploration_career → go to exploration_role_targeting OR planning
- After exploration_role_targeting → go to planning
- planning is terminal (no outgoing transitions)

## Cross-Phase Context
When entering exploration_career, include from orientation:
  job_title, industry, years_experience, education_level

When entering exploration_role_targeting, include from orientation:
  job_title, industry, years_experience, education_level
When entering exploration_role_targeting from exploration_career, also include:
  interests, constraints, candidate_directions

When entering planning, include from all prior phases:
  job_title, industry, years_experience, education_level, target_role, skills

## Business Rules

### BR-1: Orientation Gate
Block any transition out of orientation if ANY of these fields is null:
  job_title, industry, years_experience, education_level, session_goal

### BR-2: Dual-Track Routing
- If session_goal == "explore_options" → route to exploration_career
- If session_goal == "pursue_specific_role" → route to exploration_role_targeting
- Do NOT present track selection as a menu — route automatically based on session_goal

### BR-3: Mid-Session Track Transition
If a user in exploration_career names a specific target role:
- Transition to exploration_role_targeting
- Preserve ALL prior fields (interests, constraints, candidate_directions)
- Pre-populate target_role with the named role

### BR-4: Skill Assessment Threshold
Block transition from exploration_role_targeting to planning unless:
  assessments cover >= 60% of identified skills (user_rating is non-null)

### BR-5: Off-Topic Handling
If user input is unrelated to career guidance:
- Issue a single polite redirect
- Make ZERO state modifications
- Do not increment error counters for off-topic input

### BR-6: Human Escalation
After 3 failed clarification attempts on the SAME topic:
- Trigger human escalation pathway
- Generate handoff summary with context

### BR-7: Protected Characteristics — Zero Tolerance
If user volunteers age, race, gender, disability, pregnancy, religion, or other protected characteristics:
- Acknowledge politely without storing the information
- Redirect to career-relevant topics
- NEVER extract or store protected characteristic data
- This rule overrides ALL extraction instructions

## Entity Rotation Rules

### exploration_role_targeting (entity: skills)
Rotation trigger: After user rates current skill, present next unrated skill
Cross-entity context: skill_name, onet_source, required_proficiency (pre-populated from RAG)
Exit condition: All identified skills have user_rating OR user requests to move forward
Minimum entities: 3

## Conversation Limits
- Maximum 50 turns across entire conversation
- Timeout after 3600 seconds of inactivity
- Orientation phase: maximum 8 turns

## Hooks
### Pre-Conversation: Load user profile from SQLite if returning user
### Mid-Pipeline: Trigger FAISS retrieval when target_role is confirmed
### Post-Completion: Save session state to SQLite, generate episodic summary
### Pre-Resumption: Offer choice to continue previous session or start fresh

## Error Tolerance
- Max Analyzer retries: 2
- Max Speaker retries: 1
- Consecutive error threshold: 3
- Escalation action: terminate with graceful message

## Fallback Messages
- first_turn: "Welcome! I'm your Career Guidance Assistant. I'm here to help you explore career paths, identify skill gaps, and build a personalized action plan. Let's start by learning a bit about your professional background. What is your current or most recent job title?"
- standard: "I want to make sure I understand you correctly. Could you tell me a bit more about that?"
- phase_transition: "Great progress! Now let's move on to the next step in building your career plan."
- clarification: "I want to capture that accurately. Could you clarify what you mean?"
- entity_transition: "Thanks for that assessment. Let's look at the next skill."
- termination: "Thank you for this conversation. I've saved your progress, and you can return anytime to continue where we left off."

## Resumption
- Enable resumption: yes
- Resumption TTL: 86400 seconds (24 hours)
