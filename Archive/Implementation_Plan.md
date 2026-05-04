# Implementation Plan: Chatbot Improvements

## Context

The career guidance chatbot has three issues:
1. **Uses gemini-2.5-flash-lite** — needs to switch to Gemini Pro with a new API key
2. **Suggestion chips contradict chatbot questions** — hardcoded chips (e.g., "Technology & AI") shown when chatbot asks about something else (e.g., "What work activities energize you?"), creating conversation forks
3. **Skills assessment can be skipped** — the "recent graduate" case shows the chatbot jumping to plan generation without asking about skills. The assessment flow needs to be mandatory, use a 4-level scale, and enforce learning needs collection before plan generation

---

## Change 1: Switch to Gemini Pro API

### Files to modify:
- **`career-guidance-ai/.env`** — Replace `GOOGLE_API_KEY` value with `AIzaSyAMsE62kvIDbuvZtArCytFqRPei2jca3Zg`
- **`career-guidance-ai/src/config.ts`** (lines 67-68) — Change both `analyzerModel` and `speakerModel` from `"gemini-2.5-flash-lite"` to `"gemini-2.5-pro"`

---

## Change 2: Fix Suggestion Chips Fork Issue

### Root Cause
In `public/js/app.js` (lines 270-282), hardcoded chips are shown per phase, regardless of what the chatbot actually asked. The chips don't match the question, so clicking them sends contradicting input.

### Solution: Backend-generated contextual suggestions

**File 1: `agent_config/prompts/speaker_template.md`**
- Add instruction for the speaker to optionally append a `[SUGGESTIONS: opt1 | opt2 | opt3]` line at the end of its response, where options match the question being asked
- Only when the question has a finite set of likely answers

**File 2: `src/server.ts`**
- In the `/api/chat` response handler, parse `[SUGGESTIONS: ...]` from `speakerOutput`
- Strip it from the message text
- Add a `suggestions: string[]` field to the API response
- Also add `suggestions: []` to `/api/session` POST response

**File 3: `public/js/app.js`**
- Remove the hardcoded chips logic (lines 270-282)
- Remove `currentPhaseForChips` variable (line 4)
- Replace with: if `data.suggestions` has items, call `showSuggestions(data.suggestions)`; otherwise call `removeSuggestions()`

---

## Change 3: Mandatory Skills Assessment & Enhanced Flow

### 3A. Update Rating Scale (3-level to 4-level)

**File: `src/state.ts`** (line 8)
- Change `UserRating` from `"not_yet_familiar" | "working_knowledge" | "strong_proficiency"` to `"beginner" | "intermediate" | "advanced" | "expert"`

**File: `src/state.ts`** — Add new state fields:
```typescript
learningNeeds: string[]              // user's preferred learning methods
learningNeedsComplete: boolean       // true when learning prefs collected
skillsEvaluationSummary: string|null // gap analysis text after all skills rated
userConfirmedEvaluation: boolean     // user confirmed the evaluation
```

**File: `src/nodes/state-updater.ts`** (lines 19-30)
- Rewrite `deriveGapCategory` for 4-level scale:
  - `beginner` → `absent`
  - `intermediate` + high req → `underdeveloped`, else `strong`
  - `advanced` + expert req → `underdeveloped`, else `strong`
  - `expert` → `strong`

### 3B. Block direct exploration_career → planning transition

**File: `src/nodes/state-updater.ts`** (lines 254-256)
- Currently `exploration_career` with `required_complete` goes directly to `planning`
- Change to always route to `exploration_role_targeting` instead
- This ensures skills assessment is never skipped

**File: `agent_config/phase_registry.json`** (line 20)
- Remove `"planning"` from `exploration_career.allowed_targets`
- Only allow `["exploration_role_targeting"]`

### 3C. Enforce 100% skills assessment + prerequisites

**File: `src/nodes/state-updater.ts`** (lines 258-265)
- Change 60% threshold to 100% (all skills must be rated)
- Add additional gates: `learningNeedsComplete === true` AND `userConfirmedEvaluation === true`
- Only then allow transition to planning

**File: `agent_config/phase_registry.json`** (line 34)
- Update condition to: `"all_skills_rated AND learning_needs_complete AND evaluation_confirmed"`

### 3D. Limit skills to top 3-4 per category

**File: `src/utils/rag.ts`**
- After fetching O*NET skills, filter to top 4 technical + top 4 soft skills (sorted by importance/required_proficiency)
- Reuse existing `categorizeSkillType()` function

### 3E. Update prompt files

**File: `agent_config/skills/exploration_role_targeting/analyzer.md`**
- Update `user_rating` enum to `beginner | intermediate | advanced | expert`
- Update `gap_category` derivation rules
- Add extraction fields: `learning_needs`, `learning_needs_complete`, `user_confirmed_evaluation`
- Update completion: require ALL skills rated + learning needs + confirmation

**File: `agent_config/skills/exploration_role_targeting/speaker.md`**
- Update scale from 3-level to 4-level natural language
- Add post-assessment flow: present gap summary → ask for confirmation → ask learning preferences → ask timeframe (from USER) → summarize → confirm → then transition
- Explicitly forbid suggesting a timeframe

**File: `agent_config/skills/exploration_career/speaker.md`**
- Add instruction: NEVER skip to planning; always route through role_targeting for skills assessment

**File: `agent_config/skills/planning/speaker.md`**
- Add prerequisites check: if skills assessment, learning needs, or evaluation confirmation is missing, redirect back instead of generating plan

**File: `agent_config/skills/planning/analyzer.md`**
- Add prerequisites gate: if missing, set notes to "BLOCKED" and extract no planning fields

**File: `agent_config/orchestrator_rules.md`**
- Update BR-4: require 100% skills rated + learning needs + confirmation
- Add BR-8: planning phase MUST NEVER begin without completed skills assessment

### 3F. Thread new fields through the system

**File: `src/nodes/state-updater.ts`** — in `mergeRoleTargetingFields`:
- Add handling for `learning_needs`, `learning_needs_complete`, `skills_evaluation_summary`, `user_confirmed_evaluation`

**File: `src/nodes/speaker-prompt-creator.ts`** — in `getPhaseCollectedData`:
- Include new fields in `exploration_role_targeting` case
- In `getCrossPhaseContext` for planning: include prerequisite status

**File: `agent_config/state_schema.json`**:
- Update `user_rating` enum to 4-level
- Add new field definitions

### 3G. Backward compatibility

**File: `src/server.ts`** — in `migrateSession`:
- Default new fields: `learningNeeds: []`, `learningNeedsComplete: false`, etc.
- Migrate old ratings: `not_yet_familiar → beginner`, `working_knowledge → intermediate`, `strong_proficiency → advanced`

---

## Implementation Order

1. **Change 1** (Gemini Pro) — 2 files, simple swap
2. **Change 2** (Suggestion chips) — 3 files, moderate
3. **Change 3** (Skills assessment) — ~14 files, complex, implement in sub-stages 3A→3G

## Verification

1. Start the dev server (`npm run dev` or `npx ts-node src/index.ts`)
2. **Gemini Pro**: Verify chatbot responds (any conversation turn)
3. **Chips**: Start a new session, transition from orientation to exploration — verify chips match the chatbot's question, not hardcoded values
4. **Skills assessment**:
   - Test "recent graduate" flow: indicate interest in a field → verify chatbot fetches O*NET skills (3-4 tech + 3-4 soft) → presents them one at a time → uses 4-level scale
   - Try to skip to planning → verify chatbot blocks and redirects to skills assessment
   - Complete all skills → verify gap summary is shown → confirm → provide learning needs → provide timeframe → verify plan is generated only after all prerequisites met
5. Check existing sessions load without errors (backward compatibility)

