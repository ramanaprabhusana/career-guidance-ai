# Redesign Plan: Career Guidance Assistant UI
## PrepStack-style Layout, Not Features

> **Role:** UI/UX architect for a student-facing career chatbot
> **Visual reference:** PrepStack-purdue.vercel.app (layout & polish only)
> **Hard constraints:** No satirical voice, no fake metrics, no unbuilt features, preserve all existing functionality

---

## 1. Information Architecture (IA Map)

### Above the Fold (Hero Section)
```
┌──────────────────────────────────────────────────────────┐
│  [Logo]  CareerGuide AI          [Start Free] [Sign In*] │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │           HEADLINE (3 options below)                │  │
│  │           Subhead: 1 sentence value prop            │  │
│  │                                                     │  │
│  │       [ Start Your Career Journey → ]               │  │
│  │       "No sign-up required"                         │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌──────┐  ┌──────┐  ┌──────┐                            │
│  │ 1000+│  │  3   │  │  4   │   ← Trust metrics (real)  │
│  │Occu- │  │ Fed  │  │Phase │                            │
│  │pations│  │Data  │  │Coach │                            │
│  │in DB  │  │APIs  │  │Flow  │                            │
│  └──────┘  └──────┘  └──────┘                            │
└──────────────────────────────────────────────────────────┘
```
*Sign In = returning user resume (localStorage), not actual auth

### Scroll Sections (in order)
1. **How It Works** - 4-step horizontal stepper (existing, elevated)
2. **What You Get** - Feature cards grid (existing 4 cards, redesigned)
3. **Powered By Real Data** - Data source cards with live status dots (existing, elevated)
4. **Built With** - Tech stack badges (existing, redesigned as pill row)
5. **Privacy & Project Info** - Footer with privacy note + Purdue attribution

### Where Chat Lives
- Same as current: full-page takeover after clicking CTA
- Welcome/landing page disappears, chat UI fills the viewport
- Sidebar + topbar stepper + chat area + input bar (unchanged structure)

---

## 2. Wireframe Description

### Desktop (1200px+)
```
┌─────────────────────────────────────────────────────────────┐
│ LANDING STATE (before starting session)                      │
│                                                              │
│ ┌──SIDEBAR (260px)──┐  ┌──MAIN CONTENT────────────────────┐ │
│ │ Logo + tagline     │  │ ┌─HERO SECTION──────────────────┐│ │
│ │                    │  │ │  Icon (72px gradient box)      ││ │
│ │ Nav:               │  │ │  Headline (28px, bold)         ││ │
│ │  ● Career Coach    │  │ │  Subhead (16px, muted)         ││ │
│ │  ○ Dashboard [Soon]│  │ │  [CTA Button, 48px tall]       ││ │
│ │  ○ Explore [Soon]  │  │ │  "No account needed" caption   ││ │
│ │  ○ Resources [Soon]│  │ └────────────────────────────────┘│ │
│ │                    │  │                                    │ │
│ │ Tools:             │  │ ┌─TRUST BAR──────────────────────┐│ │
│ │  Export Report     │  │ │ 1000+ Occupations │ 3 APIs │ 4 ││ │
│ │                    │  │ │ Phase Coaching                  ││ │
│ │ ┌─Progress Card──┐ │  │ └────────────────────────────────┘│ │
│ │ │ Journey 0%     │ │  │                                    │ │
│ │ │ [████░░░░░░░]  │ │  │ ┌─HOW IT WORKS──────────────────┐│ │
│ │ └────────────────┘ │  │ │ ①Build → ②Explore → ③Assess → ││ │
│ │                    │  │ │         ④Plan                   ││ │
│ │ Data Sources:      │  │ └────────────────────────────────┘│ │
│ │  ● O*NET           │  │                                    │ │
│ │  ● BLS             │  │ ┌─FEATURE CARDS (2x2 grid)──────┐│ │
│ │  ● USAJOBS         │  │ │ [Profile]  [Discovery]         ││ │
│ │                    │  │ │ [Gap Anl]  [Action Plan]       ││ │
│ └────────────────────┘  │ └────────────────────────────────┘│ │
│                         │                                    │ │
│                         │ ┌─DATA SOURCES (3-col)───────────┐│ │
│                         │ │ [O*NET ●] [BLS ●] [USAJOBS ●] ││ │
│                         │ └────────────────────────────────┘│ │
│                         │                                    │ │
│                         │ ┌─FOOTER─────────────────────────┐│ │
│                         │ │ Tech badges │ Privacy │ Purdue  ││ │
│                         │ └────────────────────────────────┘│ │
│                         └────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Desktop Chat State (after clicking Start)
```
┌──SIDEBAR──┐  ┌──MAIN─────────────────────────────────────┐
│ (same)     │  │ ┌─TOPBAR STEPPER──────────────────────────┐│
│            │  │ │ ①Profile → ②Explore → ③Skills → ④Plan  ││
│            │  │ │                          [Export btn]    ││
│            │  │ └──────────────────────────────────────────┘│
│            │  │ ┌─STATS BAR───────────────────────────────┐│
│            │  │ │ Turn 3 │ Phase: Explore │ Skills: --    ││
│            │  │ └──────────────────────────────────────────┘│
│            │  │ ┌─CHAT AREA (scrollable)──────────────────┐│
│            │  │ │  [Bot avatar] Career Coach               ││
│            │  │ │  ┌────────────────────────┐              ││
│            │  │ │  │ Message bubble         │              ││
│            │  │ │  └────────────────────────┘              ││
│            │  │ │              [User avatar]               ││
│            │  │ │         ┌──────────────────┐             ││
│            │  │ │         │ User message     │             ││
│            │  │ │         └──────────────────┘             ││
│            │  │ │  [Suggestion chips row]                  ││
│            │  │ └──────────────────────────────────────────┘│
│            │  │ ┌─INPUT BAR───────────────────────────────┐│
│            │  │ │ [textarea                    ] [Send ▶] ││
│            │  │ └──────────────────────────────────────────┘│
│            │  └────────────────────────────────────────────┘│
└────────────┘
```

### Mobile (< 900px)
- Sidebar hidden (same as current)
- Hero stacks vertically: icon → headline → subhead → CTA
- Trust bar: horizontal scroll or 3-col compact
- How It Works: vertical stepper (arrows rotate 90deg, existing)
- Feature cards: single column, full-width
- Data source cards: single column, full-width
- Chat state: full screen, topbar collapses to step numbers only (existing)

### Mobile (< 600px)
- Phase step text hidden (existing)
- Chat bubbles expand to 95% width (existing)
- Input bar tighter padding (existing)

---

## 3. Component List

| # | Component | Purpose | Status |
|---|-----------|---------|--------|
| 1 | `NavBar` (top of landing) | Sticky nav with logo + CTA on landing view | **NEW** |
| 2 | `HeroSection` | Headline, subhead, primary CTA, "no signup" caption | **REDESIGN** of existing `.welcome` |
| 3 | `TrustBar` | 3 stat counters (real data only) | **NEW** |
| 4 | `HowItWorks` | 4-step horizontal stepper | **EXISTS** - polish |
| 5 | `FeatureCards` | 2x2 grid of product capabilities | **EXISTS** - redesign layout |
| 6 | `DataSourceCards` | 3 API cards with live status dots | **EXISTS** - polish |
| 7 | `TechBadges` | Pill row of tech stack | **EXISTS** - restyle |
| 8 | `Footer` | Privacy + Purdue attribution | **EXISTS** - consolidate |
| 9 | `Sidebar` | Navigation + progress + data sources | **EXISTS** - no change |
| 10 | `TopbarStepper` | Phase progress indicator | **EXISTS** - no change |
| 11 | `StatsBar` | Turn/phase/skills display | **EXISTS** - no change |
| 12 | `ChatArea` | Message list with bot/user bubbles | **EXISTS** - no change |
| 13 | `InputBar` | Textarea + send button | **EXISTS** - no change |
| 14 | `SuggestionChips` | Contextual quick-reply buttons | **EXISTS** - no change |
| 15 | `ResumeDialog` | Modal for returning users | **EXISTS** - no change |
| 16 | `CompletionCard` | End-of-session celebration + export | **EXISTS** - no change |
| 17 | `Toast` | Status/error notifications | **EXISTS** - no change |
| 18 | `ScrollToBottom` | Floating button in chat | **EXISTS** - no change |

---

## 4. Design Tokens

### Typography
| Token | Value | Usage |
|-------|-------|-------|
| `--font-family` | `'Inter', -apple-system, sans-serif` | All text (keep) |
| `--text-hero` | `32px / 700 / -0.8px tracking` | Hero headline (bump from 26px) |
| `--text-section-title` | `22px / 700 / -0.3px` | Section headers ("How It Works", "What You Get") |
| `--text-card-title` | `15px / 600` | Feature card titles (bump from 14px) |
| `--text-card-body` | `13px / 400 / 1.5` | Card descriptions (keep) |
| `--text-body` | `14px / 400 / 1.65` | Chat messages (keep) |
| `--text-caption` | `12px / 500` | Trust bar stats, captions |
| `--text-badge` | `11px / 500` | Tech badges, feature badges |
| `--text-micro` | `10px / 600 / uppercase` | Section labels, nav labels |

### Spacing
| Token | Value | Usage |
|-------|-------|-------|
| `--space-section` | `56px` | Between landing sections (up from 32px) |
| `--space-card-gap` | `20px` | Between cards (up from 16px) |
| `--space-hero-pad` | `48px 40px` | Hero area padding (up from 40px) |
| `--space-inner` | `24px` | Card internal padding (up from 20px) |

### Colors (keep all existing variables, add):
| Token | Value | Usage |
|-------|-------|-------|
| `--bg-section` | `#FAFAFA` | Alternating section backgrounds |
| `--trust-bg` | `rgba(10, 102, 194, 0.04)` | Trust bar background |
| `--card-hover-border` | `var(--primary-light)` | Feature card hover state |
| `--gradient-hero` | `linear-gradient(135deg, var(--primary), var(--primary-light))` | Hero icon (keep) |

### Buttons
| Variant | Styles |
|---------|--------|
| Primary CTA | `padding: 14px 36px; border-radius: 24px; font-size: 15px; font-weight: 600; box-shadow: 0 4px 14px rgba(10,102,194,0.3)` (keep) |
| Ghost CTA (new) | `padding: 10px 20px; background: transparent; border: 1.5px solid var(--border); color: var(--text-secondary); border-radius: 20px` |

### Cards
| Property | Value |
|----------|-------|
| border-radius | `var(--radius)` = 12px (keep) |
| border | `1px solid var(--border)` (keep) |
| shadow | `var(--shadow-sm)` default, `var(--shadow-md)` on hover |
| hover transform | `translateY(-4px)` (bump from -3px) |
| padding | `24px` (up from 20px) |

### Icons
- Keep emoji-based icons (no external icon library needed for MVP)
- Icon container: 44px (up from 40px) with 12px border-radius
- Trust bar stat icons: 36px with matching color backgrounds

---

## 5. Copy Outline

### Headline Options (pick 1)
1. **"Navigate Your Career With Real Data"**
2. **"Your AI Career Coach, Backed by Federal Data"**
3. **"From Where You Are to Where You Want to Be"**

### Subhead
> Explore 1,000+ occupations, assess your skills against O*NET benchmarks, and get a personalized action plan -- all through a guided conversation.

### Feature Card Bullets
| Card | Title | Bullet | Badge |
|------|-------|--------|-------|
| Profile Building | Build Your Profile | Share your background through a natural conversation | AI-Driven |
| Career Discovery | Discover Careers | Explore paths matched to your interests and experience | 1,000+ Occupations |
| Gap Analysis | Assess Your Skills | Compare your skills against real O*NET occupation data | Data-Powered |
| Action Plan | Get Your Plan | Receive a timeline, next steps, and exportable PDF report | PDF Export |

### How It Works Steps
1. **Tell Us About You** -- Share your background, skills, and goals
2. **Explore Paths** -- Discover careers that match your profile
3. **Assess the Gap** -- See where your skills stand vs. requirements
4. **Get Your Plan** -- Export a personalized career action plan

### Trust Bar Stats (real, verifiable)
- **1,000+** Occupations in Database
- **3** Federal Data APIs
- **4-Phase** Guided Coaching

### Privacy Line
> Your conversation stays private. No account required. No data stored permanently.

### Footer
> MGMT 59000 Final Project | Purdue University | Spring 2026

---

## 6. Accessibility Notes

### Focus States
- All interactive elements: `outline: 2px solid var(--primary); outline-offset: 2px` on `:focus-visible`
- Remove default outlines only when `:focus-visible` is supported
- CTA button: add `focus-visible` ring with `box-shadow: 0 0 0 3px var(--primary-bg)`

### Skip Link
- **EXISTS**: `<a href="#msgInput" class="skip-link">Skip to chat input</a>`
- **ADD**: Skip to main content link for landing page: `<a href="#heroSection" class="skip-link">Skip to main content</a>`
- Update skip link to target `#chatArea` when in chat mode

### ARIA
| Element | Current | Keep/Change |
|---------|---------|-------------|
| Chat area | `aria-live="polite" aria-relevant="additions"` | **Keep** |
| Phase stepper | `role="group" aria-label="Session progress"` | **Keep** |
| Progress bar | `role="progressbar" aria-valuenow` | **Keep** |
| Resume dialog | `role="dialog" aria-modal="true"` | **Keep** |
| Toast | `role="status" aria-live="polite"` | **Keep** |
| Send button | `aria-label="Send message"` | **Keep** |
| Export button | `aria-label="Export career plan report"` | **Keep** |
| Textarea | `aria-label="Type your message"` | **Keep** |
| Trust bar stats | -- | **ADD** `role="list"` with `role="listitem"` |
| Landing sections | -- | **ADD** `aria-labelledby` linking to section headings |
| Feature cards | -- | **ADD** `role="article"` for each card |

### Color Contrast
- All current color pairs meet WCAG AA (verified in prior audit)
- `--text-muted: #767676` on `--bg-white: #FFFFFF` = 4.56:1 (passes AA)
- New `--bg-section: #FAFAFA` must maintain contrast with `--text-secondary: #666666` = 5.74:1 (passes)

### Keyboard Navigation
- Tab order: skip link → sidebar nav → CTA → feature cards → data source cards → footer
- In chat mode: skip link → topbar export → chat area → input → send
- Focus trap on resume dialog (existing, working)
- Escape closes resume dialog (existing, working)

---

## 7. Implementation Notes (Single-Page App)

### File Structure
All changes go in `public/index.html` (single file, ~1725 lines currently). No new files needed.

### CSS Changes
1. Add new tokens to `:root` block (lines 11-38)
2. Add `.trust-bar` styles after `.welcome` section (~line 630)
3. Add `.section-title` utility class for consistent section headers
4. Increase `.welcome` padding and spacing tokens
5. Add `--bg-section` alternating background for visual rhythm
6. Add `:focus-visible` outline styles globally
7. Bump `.feat-card` padding from 20px to 24px, icon size from 40px to 44px
8. Add `.trust-stat` component styles

### HTML Changes
1. Add `id="heroSection"` to the hero area within `.welcome`
2. Add trust bar `<div>` between subhead and How It Works
3. Add section headings (`<h3>`) before How It Works and Feature Cards sections
4. Wrap each landing section in a `<section>` tag with `aria-labelledby`
5. Update headline text and subhead text per copy outline

### JavaScript Changes
- **None required.** All redesign changes are CSS + HTML only. Existing JS functions (`startSession`, `sendMessage`, `exportReport`, etc.) are unaffected because:
  - The CTA still calls `onclick="startSession()"`
  - The welcome screen still uses `id="welcomeScreen"`
  - The chat area still uses `id="chatArea"`
  - No DOM IDs are renamed

### What NOT to Change
- Sidebar (structure, nav items, progress card, data sources)
- Topbar stepper (phases, step numbers, lines)
- Stats bar
- Chat message rendering (`addMessage`, `renderMarkdown`)
- Input bar (textarea, send button)
- Suggestion chips
- Resume dialog
- Completion card
- Export flow
- Toast notifications
- All JavaScript logic

---

## Implementation Checklist (ordered by impact)

- [ ] **1. Hero section redesign** -- Bigger headline (32px), updated copy, trust bar with 3 real stats
- [ ] **2. Section structure** -- Wrap landing content in `<section>` tags with headings, add `--space-section` gaps
- [ ] **3. Feature cards polish** -- Larger padding (24px), bigger icons (44px), updated copy per outline
- [ ] **4. Trust bar component** -- 3-stat row below hero (1000+ Occupations, 3 APIs, 4-Phase Coaching)
- [ ] **5. Focus-visible states** -- Global `:focus-visible` outline for all interactive elements
- [ ] **6. Section headings** -- Add "How It Works", "What You Get", "Powered By Real Data" as `<h3>` headers
- [ ] **7. Alternating section backgrounds** -- `--bg-section` on even sections for visual rhythm
- [ ] **8. Data source cards polish** -- Match card padding/spacing to feature cards
- [ ] **9. Footer consolidation** -- Merge tech badges + privacy note + Purdue line into clean footer
- [ ] **10. Mobile responsive fixes** -- Trust bar horizontal scroll, section spacing adjustments
- [ ] **11. ARIA enhancements** -- `aria-labelledby` on sections, `role="article"` on cards
- [ ] **12. Skip link update** -- Dual-target (main content on landing, chat input in chat mode)
