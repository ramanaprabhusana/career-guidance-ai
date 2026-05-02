# Changelog — Functional / User-Visible

All user-facing changes to the Career Guidance AI Assistant.

---

## v3.0.0 (Planned)
**Date:** 2026-04-02

| When | Area / Part | What Changed | With What |
|------|------------|-------------|-----------|
| TBD | Resume Upload UI | Added resume PDF/DOCX upload with drag-drop | Added new view in SPA |
| TBD | Resume Review Form | Added editable confirm/edit form for extracted resume fields | Added new component |
| TBD | Interview Practice UI | Added interview mode selector (Behavioral, Technical, Case) + Q&A + rubric scorecard | Added new view in SPA |
| TBD | Resources Page | Added learning resource recommendations with free-first ordering and citations | Added new view in SPA |
| TBD | Sidebar Nav | Changed 4 "Coming Soon" items to 3 real screens (Resume, Interview, Resources) + 2 "Coming Soon" | Replaced disabled nav items with active routes |
| TBD | Export PDF/HTML | Added Resume Analysis, Interview Summary, and Resources sections to export | Extended existing export templates |
| TBD | Landing Feature Grid | Updated feature cards to reflect resume, interview, and resources capabilities | Replaced placeholder card copy |

---

## v2.1.0
**Date:** 2026-05-01

| When | Area / Part | What Changed | With What |
|------|------------|-------------|-----------|
| 19:05 ET | Chat latency | Made Gemini-only the MVP sample provider sequence and added provider timeouts | Replaced active Groq-first sample routing and unbounded provider invocation |
| 19:05 ET | No-repeat behavior | Added hard known-facts constraints before phase speaker instructions | Replaced relying only on later cross-phase known-facts context |
| 20:56 ET | Planning confirmations | Added analyzer `user_intent` classification and used it for filler/confirmation handling | Replaced regex-only handling of short replies |
| 20:56 ET | Report completion | Added role-scoped `reportGeneratedForRole` and frontend duplicate-card guard | Replaced unscoped completion card trigger after report export |
| 22:24 ET | Confirmed-state stability | Added analyzer confirmed-fields injection plus state-updater locks for orientation fields and completed skill ratings | Replaced unconditional merge of later analyzer extractions |
| 22:24 ET | Role pivots and reports | Cleared stale role-confirmation flags after pivots and added N/M skill counts to PDF strength labels | Replaced stale one-turn confirmation behavior and bare percentage-only report display |

## v2.1.1 — MVP Demo Fixes (Change 7)
**Date:** 2026-05-01

| Area | What Changed | Root Cause Fixed |
|------|-------------|-----------------|
| Pop-up after Continue | Added explicit `transitionDecision = "continue"` reset in `applyRoleSwitchPivot` fromPlanning block | Old `"complete"` value persisted in LangGraph state for one turn after role switch, causing `isComplete: true` on the next response |
| Pop-up after Continue | Added `_completionDismissedForRole` frontend variable; card only shows when role is new AND not dismissed | DOM `.completion-card` querySelector guard alone insufficient when card is removed then re-added across turns |
| Planning speaker stall loop | Added FORBIDDEN PHRASES hard ban + mandatory block-delivery rule to `agent_config/skills/planning/speaker.md` | Speaker emitting "Let's move forward" caused analyzer to see no pending yes/no → "ok" classified as filler → block never advanced |
| 0 tech skills (TPM/PM roles) | Added O*NET `/technology_skills` endpoint fetch inside `retrieveSkillsForRole` live path; up to 4 tech categories merged before `limitSkillsPerCategory` | `/skills` endpoint returns only cognitive skills (soft) for management roles; `limitSkillsPerCategory` left techSkills[] empty |

**Files changed:**
- `src/nodes/state-updater.ts` — `applyRoleSwitchPivot`: add `updates.transitionDecision = "continue"`
- `public/js/app.js` — `_completionDismissedForRole` guard + `updatePhase` clear on role switch
- `agent_config/skills/planning/speaker.md` — FORBIDDEN PHRASES section + mandatory block delivery
- `src/utils/rag.ts` — technology skills merge block in `retrieveSkillsForRole` live path; `allSkills` typed as `SkillAssessment[]`
- `src/services/onet.ts` — `getOccupationTechSkills` already present (no change needed)

**Verification:** `tsc --noEmit` clean · `validate-config` 21/21 · `golden` 14/14

---

## v2.1.2 — Post-Demo Transcript Fixes (Change 8)
**Date:** 2026-05-02

| Area | What Changed | Root Cause Fixed |
|------|-------------|-----------------|
| Positive short reactions | Extended filler handling for reactions like `nice`, `great`, `cool`, `thanks`, `perfect`, and `looks good` | Single-word positive reactions carried no career facts but could bypass the filler guard and trigger downstream report/status messages |
| Role-switch evidence attribution | Cleared active `evidenceKept` and `evidenceDiscarded` during role pivots | Prior-role O*NET evidence could appear in the new role's active report evidence log instead of only in history/appendix |
| E7 post-assessment double-ask | Split post-assessment priorities and timeline into two separate speaker turns | Asking priorities and timeline in one message caused partial answers and repeated full-block re-asks |

**Files changed:**
- `src/nodes/filler-guard.ts` — positive-reaction filler patterns
- `src/nodes/state-updater.ts` — clear active evidence arrays on role pivot
- `agent_config/skills/exploration_role_targeting/speaker.md` — sequential Step 3a priorities and Step 3b timeline
- `change_by_claude_005May01.md` — deliberation, selected fixes, and verification plan

**Verification:** `tsc --noEmit` clean · `validate-config` 21/21 · `golden` pass · `build` clean

---

## v2.0.0
**Date:** 2026-04-02

| When | Area / Part | What Changed | With What |
|------|------------|-------------|-----------|
| 00:50 ET | Welcome Page | Added 27 UI/UX improvements: How It Works stepper, Data Source cards, Tech Stack badges, project footer | Added 5 new welcome sections |
| 00:50 ET | Chat Area | Added markdown rendering in bot messages (bold, bullets, numbered lists) | Replaced plain text with innerHTML via renderMarkdown() |
| 00:50 ET | Chat Area | Added scroll-to-bottom floating button | Added new component (appears at 200px scroll distance) |
| 00:50 ET | Chat Area | Added phase-context typing indicators ("Analyzing your skills...") | Replaced generic "typing..." dots |
| 00:50 ET | Session Complete | Added completion card with export + continue buttons | Replaced toast-only completion signal |
| 00:50 ET | Export Button | Added spinner during export, green upgrade on completion | Replaced static button |
| 00:50 ET | Resume Dialog | Added focus trap, Escape key, ARIA dialog role | Replaced basic overlay |
| 00:50 ET | Stats Bar | Added session stats bar (Turn / Phase / Skills) below topbar | Added new component |
| 00:50 ET | Keyboard Hint | Added "Press Enter to send, Shift+Enter for new line" hint | Added new component (fades after first message) |
| 00:50 ET | Sidebar Nav | Added "Coming Soon" badges on unimplemented items | Replaced clickable nav items that showed error toasts |
| 00:50 ET | Network | Added offline detection before session start and message send | Added navigator.onLine checks |
| 00:50 ET | Session Recovery | Added 404 session recovery with auto-reload | Added error handler for expired sessions |
| 01:11 ET | Hero Section | Updated headline to 32px "Navigate Your Career With Real Data" | Replaced 26px "Your AI Career Coach" |
| 01:11 ET | Trust Bar | Added trust bar with 3 real stats (1000+ Occupations, 3 APIs, 4-Phase Coaching) | Added new component below hero |
| 01:11 ET | Section Structure | Wrapped all landing sections in `<section>` tags with h3 headings | Replaced flat layout with structured sections |
| 01:11 ET | Feature Cards | Updated to 24px padding, 44px icons, new copy per card | Replaced 20px padding, 40px icons, old copy |
| 01:11 ET | Data Source Cards | Matched styling to feature cards, added hover states | Replaced smaller, static cards |
| 01:11 ET | Footer | Consolidated tech badges + privacy + Purdue into single footer | Replaced scattered footer elements |
| 01:11 ET | Skip Links | Added dual skip links (#heroSection + #msgInput) | Replaced single skip link |
| 01:11 ET | Focus States | Added global :focus-visible outlines on all interactive elements | Replaced inconsistent browser defaults |
| 10:54 ET | Hero Section | Added secondary ghost CTA "See How It Works" alongside primary button | Added new button component |
| 10:54 ET | FAQ Section | Added "Good to Know" FAQ with 4 items (counseling, data sources, privacy, limitations) | Added new section |
| 10:54 ET | AI Disclaimer | Added warning box: "AI advice is informational only, not professional counseling" | Added new section |
| 10:54 ET | Bottom CTA | Added "Ready to Explore Your Career Path?" repeat CTA before footer | Added new section |
| 10:54 ET | Footer | Upgraded to 2-column layout (brand + tech left, data source links + privacy right) | Replaced single-line centered footer |

---

## v1.3.0
**Date:** 2026-03-28 — 2026-03-31

| When | Area / Part | What Changed | With What |
|------|------------|-------------|-----------|
| 03-28 01:43 | Chat | Added retry logic with 55s timeout and automatic retry | Replaced no-timeout fetch calls |
| 03-28 01:43 | Session | Added file-based session persistence (sessions/*.json) | Replaced in-memory-only storage |
| 03-28 19:40 | Observability | Added LangSmith tracing with session metadata | Added new integration |
| 03-31 -- | Start Session | Added returning user detection with resume/start-fresh dialog | Added localStorage + history endpoint |
| 03-31 -- | Data | Added data sync script for bulk O*NET + BLS + USAJOBS download | Added scripts/sync-data.ts |

---

## v1.2.0
**Date:** 2026-03-27

| When | Area / Part | What Changed | With What |
|------|------------|-------------|-----------|
| 23:46 ET | Welcome Page | Added data source status panel with O*NET, BLS, USAJOBS indicators | Added new UI section |
| 23:46 ET | Chat | Added live O*NET skill data and BLS wage data in conversations | Replaced static occupation data |
| 23:48 ET | Deployment | Added Dockerfile and Render deployment | Added new infra files |

---

## v1.1.0
**Date:** 2026-03-27

| When | Area / Part | What Changed | With What |
|------|------------|-------------|-----------|
| 19:03 ET | Entire App | Added browser-based chat UI with Express server | Replaced CLI-only interface |
| 19:03 ET | Chat | Added sidebar navigation, phase progress tracker, real-time chat | Added public/index.html |

---

## v1.0.0
**Date:** 2026-03-27

| When | Area / Part | What Changed | With What |
|------|------------|-------------|-----------|
| 18:55 ET | Entire App | Initial build: LangGraph 5-node pipeline, 4-phase flow, RAG, PDF/HTML export, CLI | N/A (greenfield) |
