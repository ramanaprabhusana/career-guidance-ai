import { buildGraph } from "../graph.js";
import { config } from "../config.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
try {
  const envPath = join(__dirname, "..", "..", ".env");
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (value && !process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // ignore
}

async function smokeTest() {
  console.log("🔬 Smoke Test: Career Guidance Assistant\n");

  // Check 1: Config loads
  console.log("✓ Config loaded successfully");
  console.log(`  - Phases: ${Object.keys(config.phaseRegistry.phases).join(", ")}`);
  console.log(`  - Default phase: ${config.phaseRegistry.default_phase}`);
  console.log(`  - LLM: ${config.analyzerModel}`);

  if (!process.env.GOOGLE_API_KEY) {
    console.log("\n⚠️  GOOGLE_API_KEY not set — skipping LLM tests");
    console.log("   Set it and re-run for full smoke test");
    process.exit(0);
  }

  const graph = buildGraph();

  // Check 2: First turn (opening message)
  console.log("\n--- Step 1: First Turn ---");
  const state1 = await graph.invoke({
    sessionId: "smoke-test-001",
    startedAt: Date.now(),
    userMessage: "",
    turnType: "first_turn",
  });

  if (!state1.speakerOutput || state1.speakerOutput.length === 0) {
    console.error("✗ First turn: no speaker output");
    process.exit(1);
  }
  console.log(`✓ Opening message (${state1.speakerOutput.length} chars):`);
  console.log(`  "${state1.speakerOutput.slice(0, 100)}..."`);

  // Check 3: One full turn with user input
  console.log("\n--- Step 2: Full Turn ---");
  const state2 = await graph.invoke({
    ...state1,
    userMessage: "I'm a software engineer with 5 years of experience in tech. I have a bachelor's degree and I'm looking to explore new career options.",
    turnType: "standard",
    conversationHistory: [
      ...state1.conversationHistory,
      {
        role: "user" as const,
        content: "I'm a software engineer with 5 years of experience in tech. I have a bachelor's degree and I'm looking to explore new career options.",
        timestamp: Date.now(),
      },
    ],
    analyzerPrompt: "",
    analyzerOutput: null,
    speakerPrompt: "",
    speakerOutput: "",
    newPhase: null,
    error: null,
  });

  if (!state2.speakerOutput || state2.speakerOutput.length === 0) {
    console.error("✗ Full turn: no speaker output");
    process.exit(1);
  }
  console.log(`✓ Response (${state2.speakerOutput.length} chars):`);
  console.log(`  "${state2.speakerOutput.slice(0, 100)}..."`);

  // Check extracted fields
  const extracted = state2.analyzerOutput?.extracted_fields;
  console.log(`✓ Analyzer extracted: ${JSON.stringify(extracted)}`);
  console.log(`✓ Current phase: ${state2.currentPhase}`);
  console.log(`✓ Turn number: ${state2.turnNumber}`);

  if (state2.error) {
    console.log(`⚠️  Error present: ${state2.error}`);
  }

  console.log("\n✅ Smoke test passed!");
  process.exit(0);
}

smokeTest().catch((e) => {
  console.error("✗ Smoke test failed:", e);
  process.exit(1);
});
