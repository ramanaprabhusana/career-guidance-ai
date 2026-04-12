# Orchestrator Rules: Career Guidance Assistant

## Transition Confidence
Do not transition between phases unless the Analyzer's confidence is at least 0.8.

## Default Phase Flow
- After orientation → go to exploration_career OR exploration_role_targeting (based on session_goal)
- After exploration_career → go to exploration_role_targeting ONLY (never directly to planning)
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
Block transition from exploration_role_targeting to planning unless ALL of:
  - assessments cover 100% of identified skills (ALL user_rating values are non-null)
  - user_confirmed_evaluation is true (user confirmed the gap summary)
  - learning_needs_complete is true (learning priorities and timeframe discussed)

### BR-5: Off-Topic Handling
If user input is unrelated to career guidance:
- Issue a single polite redirect
- Make ZERO state modifications
- Do not increment error counters for off-topic input

### BR-6: Human Escalation
After 3 failed clarification attempts on the SAME topic:
- Trigger human escalation pathway
- Generate handoff summary with context

### BR-8: Mandatory Skills Assessment
Block transition from exploration_career directly to planning.
Users who chose career exploration MUST go through exploration_role_targeting
before entering planning. The only valid exit from exploration_career is
exploration_role_targeting. Planning phase MUST NEVER begin without a completed
skills assessment (100% rated), confirmed evaluation, and discussed learning needs.

### BR-7: Protected Characteristics — Zero Tolerance
If user volunteers age, race, gender, disability, pregnancy, religion, or other protected characteristics:
- Acknowledge politely without storing the information
- Redirect to career-relevant topics
- NEVER extract or store protected characteristic data
- This rule overrides ALL extraction instructions

### BR-9: Role Switch Continuity (Change 4)
When a user pivots `target_role` within a session (or from a returning session):
- Archive the prior target to `previousTargetRole` and append it to `exploredRoles[]` with status `deprioritized`
- Snapshot the current plan to `priorPlan` if any plan content exists (recommendedPath / skillDevelopmentAgenda / immediateNextSteps)
- Rehydrate skill ratings for any `skill_name` that exists in both roles' O*NET sets via `rehydrateSkillRatings` (case+whitespace normalized match)
- Seed `roleSwitchContext = { from_role, to_role, shared_skills, rehydrated_ratings, initiated_at }`
- Emit a one-sentence recap turn BEFORE resuming skill assessment; block the planning transition until `roleSwitchAcknowledged === true`
- **DO NOT wipe orientation facts** (`jobTitle`, `industry`, `yearsExperience`, `educationLevel`, `location`, `preferredTimeline`) — those survive the pivot per BR-12

### BR-10: Role Comparison Cap (Change 4)
- Maximum of 2 roles in active comparison at any time (`comparedRoles[≤2]`)
- If the user names a 3rd, narrow down with a reasoned recommendation before proceeding
- Comparison must classify skills into `shared` / `unique_a` / `unique_b` and end with a priority recommendation grounded in user background, current skill fit, timeline, and constraints
- The `compareTwoRoles` helper in `src/utils/rag.ts` is the single source of truth for the split

### BR-11: Industry Exploration Cap (Change 4)
- Maximum 3 active candidate industries (`candidateIndustries[≤3]`)
- Hard-enforced in the LangGraph reducer; the speaker ALSO surfaces a cap warning via cross-phase context
- If the user names a 4th, narrow before proceeding — explain why the existing 3 are the strongest fit for their background
- Industry exploration must support role prioritization, not become endless browsing

### BR-12: Profile Reuse on Returning Sessions (Change 4)
- Returning users (`userPersona === "returning_continue"` or `"returning_restart"`) MUST NOT be re-asked for facts already persisted in `profiles.payload`:
  `job_title`, `industry`, `years_experience`, `education_level`, `location`, `preferred_timeline`, `explored_roles`, `prior_plan`
- The speaker MUST acknowledge known facts in its opener via the `WHAT WE ALREADY KNOW ABOUT THIS USER` block
- `applyRestartPivot` preserves profile facts but resets path-specific state per BR-9; only `applyFreshStart` wipes everything (used exclusively for the explicit "Start completely fresh" button)
- Persona detection happens at `POST /api/session` based on whether a persisted profile exists for the `userId`

## Entity Rotation Rules

### exploration_role_targeting (entity: skills)
Rotation trigger: After user rates current skill, present next unrated skill
Cross-entity context: skill_name, onet_source, required_proficiency (pre-populated from RAG)
Exit condition: All identified skills have user_rating (100% must be rated — do not allow early exit)
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

## Profile / episodic memory hooks (skills extension)
Long-term memory hooks live in `src/utils/profile-hooks.ts` and are invoked
**from inside the state-updater**, not from `server.ts`. They are guarded by
`state.userId` and no-op silently when SQLite is unavailable
(`PROFILE_DB_UNAVAILABLE`, Skill 8).

- `saveProfileHook` — fires every turn when `userId` is set; upserts
  `last_session_id`, `target_role`, `job_title`, `conversation_summary`.
- `appendEpisodicHook` — fires when `transitionDecision === "complete"` and
  a non-empty `conversation_summary` exists.
- `loadProfileHook` / `listEpisodicHook` — available for the orientation
  phase to prefill returning users (Sr 17/20 in the user-story backlog).

Server-side persistence in `server.ts` is retained as a redundant safety net
during the transition; both call sites are idempotent.

## Tool execution (skills extension)
Side effects (RAG retrieval, O*NET / BLS / USAJOBS connectors, future
web-search) MUST go through `src/nodes/tool-executor.ts` rather than being
called inline from the state-updater. The state-updater is the orchestrator:
it decides **whether** a tool runs and how the result is merged into state;
the tool-executor owns **how** the call is made and which Skill 8 error code
it surfaces on failure.

- Current registered tools: `retrieve_skills_for_role`, `web_search`, `find_courses`, `get_wage_data`, `get_job_counts`. BLS wage data and USAJOBS job counts MUST be fetched via `runTool("get_wage_data", …)` / `runTool("get_job_counts", …)`; do not import the service helpers directly from nodes (C4).
- Tool failures NEVER abort the turn — they return `{ ok: false, errorCode }`
  and the orchestrator continues with whatever data it already has.
- New tools must be added to the `ToolName` union in `tool-executor.ts` and,
  if user-visible failure messaging is needed, to `error_catalog.md`.

## Error handling (Skill 8)
All node-level error codes, severity, recovery strategy, and user-visible
fallback messages live in [`error_catalog.md`](./error_catalog.md). Nodes
must raise `AgentError(code)` from `src/utils/errors.ts` rather than
sprinkling ad-hoc strings; `validate-config` enforces parity between the
catalog and the `ErrorCode` union.

- **recoverable** errors never abort a turn — fall through to a deterministic path.
- **fatal** errors abort the current turn and surface to logs / LangSmith.
- **policy** errors (off-topic, safety) always emit a Speaker message from the catalog.
