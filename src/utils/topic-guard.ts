/**
 * Topic guard (Slice S-A, Sr 11 + 15B)
 *
 * Lightweight, dependency-free heuristic that decides whether a user message
 * is on-topic for a career-guidance conversation. Deliberately conservative:
 * we only flag messages as off-topic when they contain NO career-relevant
 * signal at all. False negatives (letting something through) are fine; false
 * positives (flagging a real career question) are not.
 *
 * The orchestrator (`state-updater.ts`) uses this to maintain
 * `offTopicStrikes`. At `MAX_OFF_TOPIC_STRIKES` the orchestrator raises
 * `OFF_TOPIC_PERSISTENT` (Skill 8 catalog) and the Speaker emits the
 * canned scope-reminder from the error catalog.
 */

export const MAX_OFF_TOPIC_STRIKES = 2;

const CAREER_KEYWORDS = [
  "career", "job", "role", "work", "industry", "company", "employer", "employee",
  "salary", "wage", "pay", "income", "promotion", "interview", "hire", "hiring",
  "resume", "cv", "cover letter", "linkedin",
  "skill", "learn", "course", "certification", "certificate", "training", "degree",
  "education", "school", "college", "university", "bachelor", "master", "phd",
  "experience", "intern", "apprentice", "apprenticeship",
  "plan", "goal", "objective", "path", "next step", "roadmap", "timeline",
  "explore", "transition", "switch", "shift", "pivot", "growth", "advance",
  "manager", "lead", "engineer", "developer", "analyst", "designer", "nurse",
  "teacher", "consultant", "advisor", "specialist", "coordinator",
  "yes", "no", "maybe", "sure", "okay", "ok", // minimal conversational acks
];

const OFF_TOPIC_HARD_MARKERS = [
  "weather", "sports score", "who won", "recipe", "movie plot", "joke", "tell me a joke",
  "stock tip", "bitcoin price", "lottery", "gambling",
];

/**
 * Returns true if the message looks off-topic (no career signal AND either
 * very short / clearly chit-chat, OR contains a hard off-topic marker).
 */
export function isOffTopic(message: string | null | undefined): boolean {
  if (!message) return false;
  const text = message.toLowerCase().trim();
  if (text.length === 0) return false;

  // Hard markers win immediately.
  if (OFF_TOPIC_HARD_MARKERS.some((m) => text.includes(m))) return true;

  // If any career keyword appears, treat as on-topic.
  if (CAREER_KEYWORDS.some((k) => text.includes(k))) return false;

  // No career signal. Flag only if the message is substantive enough to be a
  // real question/statement (avoid punishing "hi" / "hello").
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 6) return true;

  return false;
}
