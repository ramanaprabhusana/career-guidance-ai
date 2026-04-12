# Competitive Enhancement Plan — Career Guidance AI Assistant

**Created:** 2026-04-12
**Target start:** 2026-04-14
**Goal:** Transform from "another career chatbot" into a uniquely valuable tool that no competitor offers in a single product.

---

## What We Already Have (Baseline)

- 4-phase LangGraph conversational pipeline (Orientation → Exploration → Role Targeting → Planning)
- O*NET + BLS + USAJOBS live API integration
- RAG over 1,000+ occupations with FAISS
- Skills gap analysis with user self-assessment
- PDF/HTML/JSON export with 6-section career plan
- Returning user memory (episodic recall, SQLite profiles)
- Safety + topic guards
- Curated learning resources (50+ entries)
- Accessible 9-section landing page

## What Makes "Just Another Career Chatbot"

Most AI career tools do: chat → ask questions → give generic advice → done. They lack:
- **Grounding in real data** (we already have this — it's our moat)
- **Actionable, personalized outputs** (our export is good but can be richer)
- **Interactive skill-building** beyond conversation (interview practice, scenario planning)
- **Longitudinal tracking** (most are one-shot; we have episodic memory but don't leverage it)

---

## Enhancement Tiers

### TIER 1: High-Impact, Low-Effort (1-2 days each)
*These use existing infrastructure and data — mostly wiring things together.*

#### 1A. Salary Negotiation Playbook
**What:** After planning phase, generate a personalized salary negotiation guide based on BLS wage data for the target role.
**Why:** No free tool combines real wage data + AI negotiation coaching. Users get: market rate (25th/50th/75th percentile), negotiation scripts, and counter-offer strategies grounded in their experience level.
**How:**
- Add a `negotiation` section to speaker prompt in planning phase
- Use existing BLS `get_wage_data` tool to pull percentile data
- Add section to PDF/HTML export
**Files:** `agent_config/prompts/speaker_template.md`, `src/report/pdf-generator.ts`, `src/report/html-generator.ts`

#### 1B. "What If" Scenario Comparison
**What:** Let users compare 2-3 career paths side-by-side: skills overlap, salary range, growth rate, time-to-transition.
**Why:** Most tools evaluate one path at a time. Side-by-side comparison is a decision-making accelerator.
**How:**
- New endpoint `POST /api/compare` — takes 2-3 SOC codes, returns merged comparison
- Reuse existing `enrichRoleContext` from `rag.ts` + BLS/USAJOBS data
- New UI card grid showing paths side-by-side with color-coded metrics
**Files:** `src/server.ts` (new route), `public/index.html` (new view), `src/utils/rag.ts`

#### 1C. Career Transition Risk Score
**What:** Show a "Transition Difficulty" score (1-10) based on: skill gap count, years of experience gap, education gap, salary change direction.
**Why:** Gives users a gut-check metric before committing. No competitor quantifies transition difficulty.
**How:**
- Pure computation from existing state fields (skills[], yearsExperience, educationLevel, BLS wage data)
- Display in Skills Dashboard + export
- Formula: weighted sum of gap severity, experience delta, education mismatch
**Files:** `src/utils/rag.ts` (new function), `public/index.html`, `src/report/pdf-generator.ts`

#### 1D. Smart Job Alerts Summary
**What:** Show real-time USAJOBS + formatted search links for Indeed/LinkedIn for the target role, with skill-match percentage per listing.
**Why:** Bridges the gap from "plan" to "action" — users see real jobs they could apply to today.
**How:**
- Enhance existing `get_job_counts` tool to return top 5 listings with details
- Score each listing against user's skill profile
- Add "Jobs" section to sidebar or planning output
**Files:** `src/services/usajobs.ts`, `src/nodes/tool-executor.ts`, `public/index.html`

---

### TIER 2: Medium-Effort, High-Differentiation (2-4 days each)
*These add genuinely new capabilities.*

#### 2A. Mock Interview Practice
**What:** Text-based interview simulator with 3 modes (Behavioral/STAR, Technical, Case Study). Each answer gets a 5-dimension rubric scorecard + a rewritten stronger answer.
**Why:** Interview prep is the #1 request after career planning. Combining role-specific questions (grounded in O*NET skills) with structured feedback is unique.
**How:**
- Architecture already planned in `FEATURE_EXPANSION_PLAN.md`
- `src/routes/interview.ts` (start + answer endpoints)
- `src/interview/question-generator.ts` (mode-specific, O*NET-grounded)
- `src/interview/grader.ts` (5-dimension rubric via Gemini Flash)
- UI: mode selector → Q&A → scorecard display
**Files:** New `src/routes/interview.ts`, `src/interview/*.ts`, `public/index.html`

#### 2B. Career Story Generator
**What:** Generate a compelling career transition narrative the user can use in cover letters, LinkedIn summaries, and interview "tell me about yourself" answers.
**Why:** This is the hardest part of a career transition — articulating the "why." AI can draft it; user edits it. No free tool does this grounded in actual skill data.
**How:**
- New endpoint `POST /api/career-story` — uses session state (background, target role, skills, gaps)
- Speaker-style LLM call with a narrative prompt template
- Output: 3 versions (elevator pitch, LinkedIn summary, cover letter paragraph)
- Add to export
**Files:** New `src/routes/career-story.ts`, new prompt template, `src/report/pdf-generator.ts`

#### 2C. Skill Development Roadmap with Milestones
**What:** Turn the generic "development timeline" into a week-by-week learning roadmap with specific courses, estimated hours, and checkpoint quizzes.
**Why:** Goes from "you should learn Python" to "Week 1: Complete CS50 Lecture 1 (2 hrs), Week 2: DataCamp Python basics (3 hrs)." Actionable > aspirational.
**How:**
- Map skills to curated-resources.json entries with estimated durations
- Generate weekly schedule based on user's `preferredTimeline`
- Add progress tracking via existing `progressItems` infrastructure
**Files:** `src/report/pdf-generator.ts`, `data/curated-resources.json` (add duration field), `public/index.html`

#### 2D. Resume Gap Analyzer (PDF/DOCX Upload)
**What:** Upload a real resume, extract structured data, compare against target role requirements from O*NET.
**Why:** Existing `/api/upload` only does plain-text with 3 fields. Full extraction + gap analysis is what users actually need.
**How:**
- Architecture already planned in `FEATURE_EXPANSION_PLAN.md`
- Add `pdf-parse` + `mammoth` dependencies
- `src/services/resume-extractor.ts` — LLM-structured extraction
- `src/routes/resume.ts` — upload + confirm endpoints
- UI: drag-drop → review form → gap analysis display
**Files:** New `src/routes/resume.ts`, `src/services/resume-extractor.ts`, `public/index.html`, `package.json`

---

### TIER 3: High-Effort, Maximum Differentiation (1-2 weeks)
*These create a product moat that's hard to replicate.*

#### 3A. Live Job Market Intelligence Dashboard
**What:** Real-time dashboard showing: job posting volume trends, top hiring companies, salary heatmap by state, skill demand frequency — all for the user's target role.
**Why:** Turns the chatbot from a planning tool into a market intelligence platform. No free tool combines O*NET + BLS + USAJOBS into a visual dashboard.
**How:**
- New endpoint `GET /api/market-intel/:socCode`
- Aggregate data from all 3 APIs
- Frontend: chart.js or lightweight SVG charts for trends
- Cache results (API data doesn't change hourly)
**Files:** New `src/routes/market-intel.ts`, `public/index.html` (new dashboard view)

#### 3B. AI Mentor Conversations
**What:** After planning phase, users can have focused 1-on-1 conversations with AI personas who are "already in" the target role. The persona shares realistic day-in-the-life insights, common pitfalls, and insider tips.
**Why:** Mentorship access is the #1 barrier for career changers. AI personas grounded in O*NET task data can simulate realistic mentorship conversations.
**How:**
- New speaker prompt templates for mentor persona (grounded in O*NET tasks + knowledge for the role)
- Separate conversation thread (doesn't pollute main coaching session)
- 3 persona variants: Senior IC, Hiring Manager, Recent Transitioner
**Files:** New prompt templates, `src/server.ts` (new endpoint), `public/index.html`

#### 3C. Earnings Trajectory Modeling
**What:** Project salary over 5/10 years for different career paths. Show: "If you stay in current role: $X → $Y. If you switch to target role: $X → $Z."
**Why:** Financial modeling makes career decisions concrete. Uses BLS wage percentile data + growth rates.
**How:**
- Compute projection curves from BLS data (entry → median → experienced wage)
- Factor in growth rate, experience level, education premium
- Render as simple line chart in UI + table in export
**Files:** New utility function, `public/index.html`, `src/report/pdf-generator.ts`

---

## Recommended Implementation Order

**Phase 1 (Apr 14-15):** Tier 1 items — 1A, 1B, 1C, 1D
- These are quick wins using existing data/services
- Each takes ~4-6 hours
- Immediately visible in the product

**Phase 2 (Apr 16-19):** Tier 2 items — 2A, 2B, 2C
- Mock interview (2A) is the biggest differentiator
- Career Story Generator (2B) is unique and memorable
- Skill Roadmap (2C) makes the export 10x more actionable

**Phase 3 (Apr 20+):** Tier 2D + Tier 3 if time permits
- Resume upload (2D) is expected but not differentiating
- Market Intelligence (3A) is the ultimate moat
- Prioritize based on grading rubric emphasis

---

## What NOT to Build (Anti-features)

- **User authentication / login walls** — keep it zero-friction
- **ATS scoring** — legally fraught, easily commoditized
- **Fake testimonials or metrics** — per existing "Do Not Ship" rules
- **Voice features** — high effort, low differentiation for a class project
- **Mobile app** — responsive web is sufficient
- **Scraping job boards** — violates ToS, use APIs only

---

## Competitive Positioning Summary

| Capability | Us | ChatGPT | LinkedIn | PathwayU |
|-----------|----|---------|---------|---------| 
| Real federal data (O*NET/BLS/USAJOBS) | Yes | No | Partial | No |
| Skills gap analysis with self-rating | Yes | No | No | Yes |
| Salary negotiation with real wage data | Planned | Generic | No | No |
| Mock interviews with rubric scoring | Planned | Generic | Premium | No |
| Career transition risk scoring | Planned | No | No | No |
| Side-by-side path comparison | Planned | No | No | No |
| Career story generator | Planned | Generic | No | No |
| Exportable PDF career plan | Yes | No | No | Partial |
| Zero sign-up, free | Yes | Freemium | Freemium | Paid |

**Our moat:** Real government data + structured AI pipeline + zero-friction access + exportable artifacts. No competitor combines all four.
