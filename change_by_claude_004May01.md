# Change Log — Claude Session 004 (May 01 2026)

**Branch:** main  
**Session context:** Post-demo review following SE → TPM → PM transcript analysis.  
**Verification:** `tsc --noEmit` clean · `validate-config` 21/21 · `golden` 14/14

---

## Background & User Feedback

User shared a screen recording + 2 PDFs from a real session (Software Engineer → Technical Product Manager → Product Manager pivot). Six specific issues were identified:

1. One-word / short answers still breaking flow (e.g. "yeah. Fine with me" not accepted as confirmation)
2. After generating PDF, pressing **Continue** button causes a visible flash/re-fire of the completion card
3. SE → TPM career plan shows **0 tech skills** in the report
4. PM role tech skills not assessed at all
5. If tech skills sufficient for user's experience, should auto-tag rather than re-assess
6. PM role — no useful output from the agent at all

User instruction: **"Minimum changes for MVP demo. Share evaluation in tabular form before creating plan. No plan without explicit confirmation."**

After tabular evaluation, user confirmed **3 fixes for this session (Issues 1–3 as P0 MVP)**:
- Fix 2: Pop-up re-fire after Continue
- Partial of Fix 1: Planning speaker stall loop (stall phrases causing loop, not the word-matching itself)
- Fix 3: 0 tech skills in report for management/product roles

Issues 4, 5, 6 deferred post-demo.

---

## Fix 1 — Planning Speaker Stall Loop

**File:** `agent_config/skills/planning/speaker.md`

### What was happening

The planning speaker was emitting phrases like _"Let's move forward with creating your plan"_ or _"We're preparing your plan"_ — sentences that promise a plan but deliver no content. On the next turn, the analyzer would receive that message + a short user reply ("ok") and classify it as `filler` (no yes/no question had been asked). This blocked `advanceNextPlanBlock`, so the speaker ran again without advancing. It would again emit a stall phrase. The loop was infinite.

### Root cause deliberation

Two approaches considered:

**Option A — Fix the word-list in `isConfirmation()`**  
Already explored in Change 6/7 (added `user_intent` field to analyzer output). The real issue is that even a correct confirmation can't advance if the speaker never asked a yes/no question to begin with. The confirmation detection is fine; the speaker must be stopped from emitting content-free promises.

**Option B — Hard ban the stall phrases in the speaker prompt**  
Simpler, directly prevents the bad state. An LLM that never emits stall phrases cannot trigger the loop.

Chose Option B because it addresses the cause rather than the symptom. Patched the `Block-by-Block Delivery` section of `planning/speaker.md` with:
- **FORBIDDEN PHRASES** list (hard ban, no exceptions)
- **WHAT TO DO INSTEAD** — mandatory immediate block delivery rule with a wrong/right example

The rule is: if you are in the planning phase and context contains `Next plan block to present`, emit that block's content directly. Never announce that you are about to present something without presenting it in the same message.

---

## Fix 2 — Completion Card Re-fires After Continue

**Files:** `src/nodes/state-updater.ts`, `public/js/app.js`

### What was happening

After a full planning session ending in PDF export, the user pressed **Continue Conversation**. The card was removed from the DOM. But on the very next chat turn, the completion card would re-appear.

### Root cause investigation

Three suspects, investigated in order:

**Suspect A — `reportGeneratedForRole` not being cleared on pivot**  
Change 6 introduced role-scoped completion. But the `applyRoleSwitchPivot` function already sets `reportGeneratedForRole = null`. Ruled out as primary cause.

**Suspect B — DOM guard insufficient**  
Change 6 also added `!document.querySelector('.completion-card')` before inserting the card. This correctly blocks a second card while the first is visible — but once the user dismisses it (removes it from DOM), the guard no longer fires. The next `isComplete: true` response from the backend re-inserts the card. Partial cause.

**Suspect C — `transitionDecision` persistence (root cause)**  
LangGraph state channels reduce by replacement when set. After `applyRoleSwitchPivot` completes, the state still holds `transitionDecision = "complete"` from the prior role's plan. `applyRoleSwitchPivot` was resetting `reportGenerated`, `reportGeneratedForRole`, phase, turn count — but NOT `transitionDecision`. On the next API request (the Continue turn), the server reads `state.transitionDecision === "complete"` and returns `isComplete: true`. The frontend then fires the card again.

### Fix applied

**Backend** (`state-updater.ts`, `applyRoleSwitchPivot`, `fromPlanning` block):

```typescript
updates.transitionDecision = "continue";
// Reason: old "complete" bleeds into next API response for one turn after pivot.
// This must be set before the response is serialized.
```

**Frontend** (`public/js/app.js`) — three-layer guard:

| Layer | Location | What it does |
|-------|----------|--------------|
| 1 (Change 6) | Backend `state-updater.ts` | `reportGeneratedForRole === targetRole` check before setting `isComplete: true` |
| 2 (Change 6) | Frontend DOM guard | `!document.querySelector('.completion-card')` — blocks double-insert while card visible |
| 3 (Change 7) | Frontend `_completionDismissedForRole` variable | Records which role's card the user dismissed; suppresses re-insert for that role |

Layer 3 specifics:
- `_completionDismissedForRole` is set when user clicks **Continue Conversation** (reads `card.dataset.role`)
- Card element gets `data-role` stamped from `profile.targetRole` when created
- `updatePhase()` clears the variable when `phase === 'exploration_role_targeting'` and `currentPhase === 'planning'` — this is the role-switch signal, so a new role's card must be allowed to appear

---

## Fix 3 — 0 Tech Skills for Management / Product Roles (TPM, PM)

**Files:** `src/utils/rag.ts`, `src/services/onet.ts` (read-only — function already existed)

### What was happening

For roles like Technical Product Manager and Product Manager, the career plan report showed **0 / 0 tech skills** and a 0% tech-skills readiness score. The assessment also asked no technology-related questions.

### Root cause investigation

O*NET exposes two separate endpoints for a given SOC code:

| Endpoint | Returns | Classification |
|----------|---------|----------------|
| `/occupations/{soc}/summary/skills` | Cognitive work skills (Active Listening, Critical Thinking, Judgment, Communication…) | All classified as "soft" by `categorizeSkillType()` |
| `/occupations/{soc}/summary/technology_skills` | Tool/software categories (Project management software, Data base user interface and query software…) | Would be classified as "technical" |

`retrieveSkillsForRole()` in `rag.ts` only called the `/skills` endpoint. For management/product roles, all returned skills matched the `SOFT_SKILLS` set. `limitSkillsPerCategory(4)` then returned 0 technical items. The report's `techSkills[]` was empty.

`getOccupationTechSkills()` already existed in `src/services/onet.ts` (line 101–113) — it had been written as a utility but never wired into the skill assessment path. No new service code was needed.

### Approach considered

**Option A — Expand the `SOFT_SKILLS` set**  
Would not help — the issue is not mis-classification of existing skills; it's that technology skill categories are never fetched at all.

**Option B — Change `categorizeSkillType()` heuristics**  
Would reclassify some ambiguous cognitive skills as technical (e.g. "Monitoring"). Unreliable and would break other roles.

**Option C — Fetch `/technology_skills` and merge (chosen)**  
Correct at the source. Fetch tech categories for the SOC code, deduplicate by name against the cognitive skills already in `allSkills`, then push up to 4 items before calling `limitSkillsPerCategory`. The tech merge is wrapped in a try/catch so a failed secondary fetch never breaks the primary assessment.

### Fix applied

In `retrieveSkillsForRole()`, inside the live O*NET success block, after building `allSkills` from `/skills`:

```typescript
const allSkills: SkillAssessment[] = liveResult.skills.map(...);   // typed explicitly (TypeScript fix)

try {
  const techCategories = await getOccupationTechSkills(liveResult.socCode);
  const techItems: SkillAssessment[] = [];
  for (const cat of techCategories) {
    if (techItems.length >= 4) break;
    const skillName = cat.title;
    const alreadyPresent = allSkills.some(s => s.skill_name.toLowerCase() === skillName.toLowerCase());
    if (alreadyPresent) continue;
    techItems.push({ skill_name: skillName, ..., skill_type: "technical" });
  }
  if (techItems.length > 0) allSkills.push(...techItems);
} catch (techErr) {
  console.warn("[RAG] Technology skills fetch failed (non-fatal):", ...);
}

result = limitSkillsPerCategory(allSkills);   // now sees up to 4 tech + 4 soft
```

The `allSkills` array was also explicitly typed as `SkillAssessment[]` (was inferred as an anonymous object literal type with `user_rating: null` literal, which caused a TypeScript error when tech items with the full `UserRating | null` union were pushed into it).

---

## Files Changed in This Session

| File | Change | Why |
|------|--------|-----|
| `agent_config/skills/planning/speaker.md` | Added FORBIDDEN PHRASES ban + mandatory block-delivery rule | Eliminates stall-phrase → filler-loop |
| `src/nodes/state-updater.ts` | `applyRoleSwitchPivot`: add `updates.transitionDecision = "continue"` | Stops `"complete"` bleeding into next API response after pivot |
| `public/js/app.js` | `_completionDismissedForRole` variable + 3-layer card guard + `updatePhase` clear | Prevents card re-fire for same role after user dismisses it |
| `src/utils/rag.ts` | Import `getOccupationTechSkills`; merge tech skill categories after `/skills` fetch; type `allSkills` explicitly | Ensures TPM/PM roles get technology skill items in assessment |
| `CHANGELOG.md` | Appended v2.1.1 entry | Record keeping |

---

## What Was NOT Changed (and Why)

| Area | Decision |
|------|----------|
| `isConfirmation()` function body | Not expanded — it is kept as a deterministic fallback only; context-aware classification is `user_intent` from the analyzer |
| `src/services/onet.ts` | `getOccupationTechSkills` already existed; no change needed |
| `src/report/pdf-generator.ts` | Cosmetic N/M tech skill counts were added in the prior session (Change 7 first pass); not re-touched |
| Issue 5 (auto-tag sufficient tech skills) | Deferred post-demo — requires skill-level comparison against user's years_experience; non-trivial |
| Issue 4 (PM mid-planning tech re-assessment) | Deferred post-demo |
| Issue 6 (PM role — no useful agent output) | Needs more transcript data; likely a RAG fallback path issue; deferred |

---

## Verification Results

```
npx tsc --noEmit          → clean (0 errors)
npm run validate-config   → 21/21 checks passed
npm run golden            → 14/14 assertions passed
```

Manual smoke still required before demo:
- Start `npm run dev`, run SE → TPM session end-to-end
- Verify TPM skill list includes technology categories (e.g. "Project management software")
- Generate PDF, press Continue, send a new message — confirm no card re-fire
- Say "yeah. Fine with me" when asked to confirm a plan block — confirm it advances
