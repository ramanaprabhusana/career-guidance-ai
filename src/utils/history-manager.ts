import type { ConversationTurn } from "../state.js";

const MAX_RECENT_TURNS = 10;

export function getRecentTurns(history: ConversationTurn[], maxTurns: number = MAX_RECENT_TURNS): string {
  const recent = history.slice(-maxTurns);
  if (recent.length === 0) return "(no prior turns)";

  return recent
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
    .join("\n");
}

export function getConversationSummary(summary: string): string {
  return summary || "(no summary yet)";
}

export function formatCollectedData(fields: Record<string, unknown>): string {
  const entries = Object.entries(fields).filter(
    ([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)
  );

  if (entries.length === 0) return "(nothing collected yet)";

  return entries
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        return `- ${k}: ${JSON.stringify(v)}`;
      }
      return `- ${k}: ${v}`;
    })
    .join("\n");
}

export function formatMissingFields(
  schemaFields: Record<string, { required?: boolean }>,
  collectedFields: Record<string, unknown>
): { missing_required: string; missing_optional: string } {
  const missingRequired: string[] = [];
  const missingOptional: string[] = [];

  for (const [fieldName, fieldDef] of Object.entries(schemaFields)) {
    const value = collectedFields[fieldName];
    const isEmpty = value === null || value === undefined || value === "" ||
      (Array.isArray(value) && value.length === 0);

    if (isEmpty) {
      if (fieldDef.required) {
        missingRequired.push(fieldName);
      } else {
        missingOptional.push(fieldName);
      }
    }
  }

  return {
    missing_required: missingRequired.length > 0 ? missingRequired.join(", ") : "(none)",
    missing_optional: missingOptional.length > 0 ? missingOptional.join(", ") : "(none)",
  };
}
