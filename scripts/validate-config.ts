/**
 * validate-config.ts
 * Validates that agent_config files are consistent with source code.
 * Run with: npx tsx scripts/validate-config.ts
 */

import { readFileSync, existsSync } from "fs";
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
