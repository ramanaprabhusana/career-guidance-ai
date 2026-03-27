import { createInterface } from "readline";
import { v4 as uuidv4 } from "uuid";
import { config } from "./config.js";
import { buildGraph } from "./graph.js";
import type { AgentStateType } from "./state.js";

// Validate environment
function validateEnv(): void {
  if (!process.env.GOOGLE_API_KEY) {
    console.error("ERROR: GOOGLE_API_KEY environment variable is required.");
    console.error("Get a free API key at: https://aistudio.google.com/apikey");
    console.error('Then set it: export GOOGLE_API_KEY="your-key-here"');
    process.exit(1);
  }
}

async function main() {
  // Load .env manually if dotenv not available
  try {
    const { readFileSync } = await import("fs");
    const { join, dirname } = await import("path");
    const { fileURLToPath } = await import("url");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const envPath = join(__dirname, "..", ".env");
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
    // .env file not found — that's okay if env vars are set
  }

  validateEnv();

  const graph = buildGraph();
  const sessionId = uuidv4();

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║     Career Guidance Assistant                ║");
  console.log("║     Type 'quit' to exit, 'export' for report ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  // First turn — get opening message
  let state = await graph.invoke({
    sessionId,
    startedAt: Date.now(),
    userMessage: "",
    turnType: "first_turn",
  });

  console.log(`Assistant: ${state.speakerOutput}\n`);

  // Interactive loop
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = (): void => {
    rl.question("You: ", async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        askQuestion();
        return;
      }

      if (trimmed.toLowerCase() === "quit" || trimmed.toLowerCase() === "exit") {
        console.log("\n" + config.fallbackMessages.termination);
        rl.close();
        return;
      }

      if (trimmed.toLowerCase() === "export") {
        try {
          const { generatePDFReport } = await import("./report/pdf-generator.js");
          const { generateHTMLReport } = await import("./report/html-generator.js");
          console.log("\nGenerating reports...");
          const pdfPath = await generatePDFReport(state);
          const htmlPath = generateHTMLReport(state);
          console.log(`PDF report: ${pdfPath}`);
          console.log(`HTML report: ${htmlPath}\n`);
          state = { ...state, reportGenerated: true };
        } catch (e) {
          console.error(`\n[Export error: ${(e as Error).message}]\n`);
        }
        askQuestion();
        return;
      }

      try {
        // Run one turn through the graph
        state = await graph.invoke({
          ...state,
          userMessage: trimmed,
          turnType: "standard",
          conversationHistory: [
            ...state.conversationHistory,
            { role: "user" as const, content: trimmed, timestamp: Date.now() },
          ],
          // Reset per-turn fields
          analyzerPrompt: "",
          analyzerOutput: null,
          speakerPrompt: "",
          speakerOutput: "",
          newPhase: null,
          error: null,
        });

        console.log(`\nAssistant: ${state.speakerOutput}\n`);

        // Check if conversation should end
        if (state.transitionDecision === "complete") {
          console.log("\n[Session complete. Thank you!]");
          rl.close();
          return;
        }

        askQuestion();
      } catch (e) {
        console.error(`\n[Error: ${(e as Error).message}]\n`);
        askQuestion();
      }
    });
  };

  askQuestion();
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
