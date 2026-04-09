/**
 * validate-config.ts
 * Validates that agent_config files are consistent with source code.
 * Run with: npx tsx scripts/validate-config.ts
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

interface CheckResult {
  name: string;
  passed: boolean;
  details: string;
}

const results: CheckResult[] = [];

function check(name: string, passed: boolean, details: string) {
  results.push({ name, passed, details });
}

// --- Load config artifacts ---

const registryPath = join(ROOT, "agent_config", "phase_registry.json");
const schemaPath = join(ROOT, "agent_config", "state_schema.json");
const stateTsPath = join(ROOT, "src", "state.ts");
const promptsDir = join(ROOT, "agent_config", "prompts");

const registry = JSON.parse(readFileSync(registryPath, "utf-8"));
const stateSchema = JSON.parse(readFileSync(schemaPath, "utf-8"));
const stateTsContent = readFileSync(stateTsPath, "utf-8");

const phaseNames = Object.keys(registry.phases);

// --- Check 1: All phases have corresponding prompt files ---

for (const phase of phaseNames) {
  const analyzerPath = join(promptsDir, `${phase}_analyzer.md`);
  const speakerPath = join(promptsDir, `${phase}_speaker.md`);

  // Also accept the shared template approach (analyzer_template.md / speaker_template.md)
  const sharedAnalyzer = join(promptsDir, "analyzer_template.md");
  const sharedSpeaker = join(promptsDir, "speaker_template.md");

  const hasAnalyzer = existsSync(analyzerPath) || existsSync(sharedAnalyzer);
  const hasSpeaker = existsSync(speakerPath) || existsSync(sharedSpeaker);

  check(
    `Phase "${phase}" has analyzer prompt`,
    hasAnalyzer,
    hasAnalyzer
      ? `Found: ${existsSync(analyzerPath) ? analyzerPath : sharedAnalyzer}`
      : `Missing: expected ${analyzerPath} or ${sharedAnalyzer}`
  );

  check(
    `Phase "${phase}" has speaker prompt`,
    hasSpeaker,
    hasSpeaker
      ? `Found: ${existsSync(speakerPath) ? speakerPath : sharedSpeaker}`
      : `Missing: expected ${speakerPath} or ${sharedSpeaker}`
  );
}

// --- Check 2: All phases have analyzer.md and speaker.md (shared or per-phase) ---

const sharedAnalyzerExists = existsSync(join(promptsDir, "analyzer_template.md"));
const sharedSpeakerExists = existsSync(join(promptsDir, "speaker_template.md"));

check(
  "Shared analyzer_template.md exists",
  sharedAnalyzerExists,
  sharedAnalyzerExists ? "Found" : "Missing (per-phase files may be used instead)"
);

check(
  "Shared speaker_template.md exists",
  sharedSpeakerExists,
  sharedSpeakerExists ? "Found" : "Missing (per-phase files may be used instead)"
);

// Skill 7: rolling-summary template (G1)
const summaryTemplatePath = join(promptsDir, "summary_template.md");
const summaryTemplateExists = existsSync(summaryTemplatePath);
check(
  "Skill 7 summary_template.md exists",
  summaryTemplateExists,
  summaryTemplateExists ? "Found" : `Missing: expected ${summaryTemplatePath}`
);
if (summaryTemplateExists) {
  const body = readFileSync(summaryTemplatePath, "utf-8");
  const requiredPlaceholders = ["{{phase}}", "{{target_role}}", "{{session_goal}}", "{{history}}"];
  const missing = requiredPlaceholders.filter((p) => !body.includes(p));
  check(
    "summary_template.md has required placeholders",
    missing.length === 0,
    missing.length === 0 ? "All placeholders present" : `Missing: ${missing.join(", ")}`
  );
}

// --- Check 3: State schema fields match state.ts exports ---

// Extract field names from AgentState in state.ts
const stateFieldRegex = /^\s+(\w+):\s*Annotation</gm;
const tsFields = new Set<string>();
let match: RegExpExecArray | null;
while ((match = stateFieldRegex.exec(stateTsContent)) !== null) {
  tsFields.add(match[1]);
}

// Collect all field names from state_schema.json (snake_case) and map to camelCase
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

const schemaFields = new Set<string>();
for (const phase of Object.keys(stateSchema.phases)) {
  for (const field of Object.keys(stateSchema.phases[phase])) {
    schemaFields.add(field);
  }
}

const missingInTs: string[] = [];
for (const schemaField of schemaFields) {
  const camel = snakeToCamel(schemaField);
  if (!tsFields.has(camel)) {
    missingInTs.push(`${schemaField} (expected as ${camel} in state.ts)`);
  }
}

check(
  "All state_schema fields have matching state.ts fields",
  missingInTs.length === 0,
  missingInTs.length === 0
    ? `All ${schemaFields.size} schema fields found in state.ts`
    : `Missing in state.ts: ${missingInTs.join(", ")}`
);

// --- Skill 8: error catalog parity (G3) ---

const errorCatalogPath = join(ROOT, "agent_config", "error_catalog.md");
const errorsTsPath = join(ROOT, "src", "utils", "errors.ts");
const catalogExists = existsSync(errorCatalogPath);
const errorsTsExists = existsSync(errorsTsPath);

check(
  "Skill 8 error_catalog.md exists",
  catalogExists,
  catalogExists ? "Found" : `Missing: ${errorCatalogPath}`
);
check(
  "src/utils/errors.ts exists",
  errorsTsExists,
  errorsTsExists ? "Found" : `Missing: ${errorsTsPath}`
);

if (catalogExists && errorsTsExists) {
  const catalogBody = readFileSync(errorCatalogPath, "utf-8");
  const errorsBody = readFileSync(errorsTsPath, "utf-8");

  // Pull codes from the markdown table (first column wrapped in backticks).
  const catalogCodes = new Set<string>();
  for (const m of catalogBody.matchAll(/^\|\s*`([A-Z_]+)`\s*\|/gm)) {
    catalogCodes.add(m[1]);
  }

  // Pull codes from the ErrorCode union literals.
  const tsCodes = new Set<string>();
  const unionMatch = errorsBody.match(/export type ErrorCode\s*=([\s\S]*?);/);
  if (unionMatch) {
    for (const m of unionMatch[1].matchAll(/"([A-Z_]+)"/g)) {
      tsCodes.add(m[1]);
    }
  }

  const onlyInCatalog = [...catalogCodes].filter((c) => !tsCodes.has(c));
  const onlyInTs = [...tsCodes].filter((c) => !catalogCodes.has(c));

  check(
    "error_catalog ↔ ErrorCode union parity",
    onlyInCatalog.length === 0 && onlyInTs.length === 0,
    onlyInCatalog.length === 0 && onlyInTs.length === 0
      ? `${catalogCodes.size} codes match`
      : `Catalog-only: [${onlyInCatalog.join(", ")}] | TS-only: [${onlyInTs.join(", ")}]`
  );
}

// --- G7: evidence_discarded reason required ---

const discardedSpec = stateSchema?.phases?.planning?.evidence_discarded;
const requiredFields: string[] = Array.isArray(discardedSpec?.required_per_entity_fields)
  ? discardedSpec.required_per_entity_fields
  : [];
check(
  "evidence_discarded requires `reason` (G7)",
  requiredFields.includes("reason") && requiredFields.includes("source") && requiredFields.includes("detail"),
  requiredFields.length > 0
    ? `required_per_entity_fields = [${requiredFields.join(", ")}]`
    : "Missing required_per_entity_fields on evidence_discarded"
);

// --- C6: Skill 9 cross-artifact drift checks ---

// C6.1: every phase in phase_registry has agent_config/skills/<phase>/analyzer.md AND speaker.md
const skillsDir = join(ROOT, "agent_config", "skills");
{
  const missing: string[] = [];
  for (const phase of phaseNames) {
    const phaseDir = join(skillsDir, phase);
    const analyzerMd = join(phaseDir, "analyzer.md");
    const speakerMd = join(phaseDir, "speaker.md");
    if (!existsSync(analyzerMd)) missing.push(`${phase}/analyzer.md`);
    if (!existsSync(speakerMd)) missing.push(`${phase}/speaker.md`);
  }
  check(
    "Every phase_registry phase has skills/<phase>/{analyzer,speaker}.md (C6)",
    missing.length === 0,
    missing.length === 0 ? `${phaseNames.length} phases checked` : `Missing: ${missing.join(", ")}`
  );
}

// C6.2: no orphan folders under agent_config/skills/ without a phase_registry entry
{
  const orphans: string[] = [];
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir)) {
      const entryPath = join(skillsDir, entry);
      if (!statSync(entryPath).isDirectory()) continue;
      if (!phaseNames.includes(entry)) orphans.push(entry);
    }
  }
  check(
    "No orphan skills/<folder> without phase_registry entry (C6)",
    orphans.length === 0,
    orphans.length === 0 ? "none" : `Orphan folders: ${orphans.join(", ")}`
  );
}

// C6.3: every backticked field name in orchestrator_rules.md that looks like a
// schema field (snake_case, not a code symbol) exists either in state_schema.json
// or is a documented runtime-only annotation in state.ts. This is a soft scan —
// we skip obvious code / file / tool names.
{
  const rulesPath = join(ROOT, "agent_config", "orchestrator_rules.md");
  if (existsSync(rulesPath)) {
    const rulesBody = readFileSync(rulesPath, "utf-8");
    const snakeCaseFieldRe = /`([a-z][a-z0-9_]*[a-z0-9])`/g;
    // Known non-field tokens that happen to be snake_case/lowercase in backticks.
    const IGNORE = new Set<string>([
      "state-updater.ts", "tool-executor.ts", "error_catalog.md", "errors.ts",
      "runtool", "agenterror", "ok", "errorcode", "tool-executor",
      "retrieve_skills_for_role", "web_search", "find_courses", "get_wage_data", "get_job_counts",
      "onet_username", "bls_api_key", "usajobs_api_key", "usajobs_email",
      "validate-config", "first_turn", "phase_transition", "standard",
      "skill_assessment", "low_confidence", "entity_transition",
      "user_rating", "required_complete", "phase_suggestion",
      "clarification_needed",
    ]);
    const runtimeOnly = new Set<string>([
      "off_topic_strikes", "safety_strikes", "plan_blocks", "shift_intent",
      "prior_session_summary", "prior_episodic_summaries", "is_returning_user",
      "resume_choice", "resume_name", "resume_years", "resume_domain",
      "conversation_summary", "conversation_history", "turn_number",
      "phase_turn_number", "current_phase", "new_phase", "turn_type",
      "user_message", "analyzer_prompt", "analyzer_output", "speaker_prompt",
      "speaker_output", "error", "user_id", "session_id", "started_at",
      "user_changed_phase", "max_phase_redirects", "transition_decision",
      "skills_assessment_status", "candidate_skills",
      // Profile DB columns referenced from orchestrator_rules.md but stored
      // outside state_schema (they live in SQLite via profile-hooks.ts).
      "last_session_id", "target_role", "job_title",
    ]);
    const schemaFieldSet = new Set<string>();
    for (const phase of Object.keys(stateSchema.phases)) {
      for (const field of Object.keys(stateSchema.phases[phase])) {
        schemaFieldSet.add(field);
      }
    }
    const unknown: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = snakeCaseFieldRe.exec(rulesBody)) !== null) {
      const token = m[1];
      if (!/_/.test(token)) continue; // require at least one underscore to filter out simple words
      if (IGNORE.has(token)) continue;
      if (runtimeOnly.has(token)) continue;
      if (schemaFieldSet.has(token)) continue;
      unknown.push(token);
    }
    const uniqueUnknown = [...new Set(unknown)];
    check(
      "orchestrator_rules.md field references resolve to schema or runtime-only (C6)",
      uniqueUnknown.length === 0,
      uniqueUnknown.length === 0
        ? "all backticked field tokens resolve"
        : `Unresolved: ${uniqueUnknown.join(", ")}`
    );
  }
}

// --- C7: Skill 8 recovery column parity ---

if (catalogExists && errorsTsExists) {
  const catalogBody = readFileSync(errorCatalogPath, "utf-8");
  const errorsBody = readFileSync(errorsTsPath, "utf-8");
  // Catalog table header should include a Recovery column after C7.
  const headerMatch = catalogBody.match(/^\|[^\n]*Recovery[^\n]*\|/m);
  const errorsHasRecovery = /recovery\s*:/i.test(errorsBody) && /recoveryFor/.test(errorsBody);
  check(
    "error_catalog.md has Recovery column and errors.ts exports recoveryFor (C7)",
    !!headerMatch && errorsHasRecovery,
    !!headerMatch && errorsHasRecovery
      ? "recovery matrix present in catalog + errors.ts"
      : `catalog_has_column=${!!headerMatch} errors_has_recovery=${errorsHasRecovery}`
  );
}

// --- Print Results ---

console.log("\n  Config Validation Results");
console.log("  ========================\n");

let allPassed = true;
for (const r of results) {
  const status = r.passed ? "PASS" : "FAIL";
  const icon = r.passed ? "+" : "-";
  if (!r.passed) allPassed = false;
  console.log(`  [${icon}] ${status}: ${r.name}`);
  if (!r.passed) {
    console.log(`         ${r.details}`);
  }
}

console.log(`\n  ${results.filter((r) => r.passed).length}/${results.length} checks passed.\n`);

process.exit(allPassed ? 0 : 1);
