/**
 * Safety guard (Slice S-F, Sr 12)
 *
 * Lightweight keyword screen for offensive / sexist / discriminatory
 * language. Deliberately narrow — we do NOT attempt to do full content
 * moderation; we just catch obvious markers so the orchestrator can
 * increment `safetyStrikes` and eventually raise `SAFETY_BLOCK`.
 *
 * The list is intentionally short and non-exhaustive. Real deployments
 * should front this with a proper moderation API.
 */

const OFFENSIVE_MARKERS = [
  // Sexist / misogynist
  "sexist", "misogyn",
  // Slurs and hard markers
  "slut", "whore", "bitch", "dyke", "faggot", "tranny", "retard",
  // Race / origin slurs (placeholder subset)
  "nigger", "chink", "kike", "spic", "gook",
  // Explicit sexual solicitation directed at the bot
  "send nudes", "sex chat", "talk dirty",
];

export function isOffensive(message: string | null | undefined): boolean {
  if (!message) return false;
  const text = message.toLowerCase();
  return OFFENSIVE_MARKERS.some((m) => text.includes(m));
}

export const MAX_SAFETY_STRIKES = 2;
