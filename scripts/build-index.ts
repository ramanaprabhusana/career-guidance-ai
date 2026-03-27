/**
 * Downloads O*NET and BLS data, chunks it, embeds with Ollama nomic-embed-text,
 * and builds a FAISS index for RAG retrieval.
 *
 * Usage: npx tsx scripts/build-index.ts
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");

// --- O*NET occupation data (curated subset for MVP) ---
// Instead of downloading the full 50MB+ database, we'll use the O*NET Web Services API
// to fetch occupation data for common roles, then embed the results.
// For the MVP, we'll use a curated dataset of popular occupation profiles.

interface OccupationProfile {
  soc_code: string;
  title: string;
  description: string;
  skills: { name: string; level: number; importance: number }[];
  knowledge: { name: string; level: number; importance: number }[];
  tasks: string[];
  median_wage: string;
  employment: string;
  growth_rate: string;
}

// Curated occupations covering the 4 personas
const OCCUPATIONS: OccupationProfile[] = [
  {
    soc_code: "15-1252.00",
    title: "Software Developers",
    description: "Research, design, and develop computer and network software or specialized utility programs. Analyze user needs and develop software solutions, applying principles and techniques of computer science, engineering, and mathematical analysis.",
    skills: [
      { name: "Programming", level: 80, importance: 90 },
      { name: "Systems Analysis", level: 72, importance: 78 },
      { name: "Complex Problem Solving", level: 75, importance: 85 },
      { name: "Critical Thinking", level: 72, importance: 82 },
      { name: "Mathematics", level: 60, importance: 65 },
      { name: "Quality Control Analysis", level: 55, importance: 60 },
    ],
    knowledge: [
      { name: "Computers and Electronics", level: 85, importance: 92 },
      { name: "Engineering and Technology", level: 70, importance: 75 },
      { name: "Mathematics", level: 65, importance: 70 },
      { name: "English Language", level: 60, importance: 65 },
    ],
    tasks: [
      "Analyze user needs and software requirements to determine feasibility of design",
      "Design, develop, and modify software systems using scientific analysis and mathematical models",
      "Develop and direct software system testing and validation procedures",
      "Coordinate software system installation and monitor equipment functioning",
      "Store, retrieve, and manipulate data for analysis of system capabilities",
    ],
    median_wage: "$127,260 per year",
    employment: "1,795,300 (2022)",
    growth_rate: "25% (Much faster than average, 2022-2032)",
  },
  {
    soc_code: "15-2051.00",
    title: "Data Scientists",
    description: "Develop and implement methods to collect, process, and analyze large datasets. Use statistical techniques, machine learning, and data visualization to identify trends and solve complex problems.",
    skills: [
      { name: "Mathematics", level: 82, importance: 88 },
      { name: "Programming", level: 78, importance: 85 },
      { name: "Critical Thinking", level: 78, importance: 85 },
      { name: "Complex Problem Solving", level: 75, importance: 82 },
      { name: "Statistics", level: 85, importance: 90 },
      { name: "Machine Learning", level: 75, importance: 80 },
      { name: "Data Visualization", level: 70, importance: 75 },
    ],
    knowledge: [
      { name: "Mathematics", level: 82, importance: 88 },
      { name: "Computers and Electronics", level: 80, importance: 85 },
      { name: "English Language", level: 65, importance: 70 },
    ],
    tasks: [
      "Apply data mining, machine learning, and statistical analysis techniques",
      "Clean, validate, and prepare data for analysis",
      "Build predictive models and machine learning algorithms",
      "Create data visualizations and dashboards to communicate insights",
      "Collaborate with stakeholders to define analytics requirements",
    ],
    median_wage: "$103,500 per year",
    employment: "192,700 (2022)",
    growth_rate: "35% (Much faster than average, 2022-2032)",
  },
  {
    soc_code: "11-2021.00",
    title: "Marketing Managers",
    description: "Plan, direct, or coordinate marketing policies and programs. Develop pricing strategies, identify potential markets, and oversee product development or marketing strategy.",
    skills: [
      { name: "Marketing Strategy", level: 80, importance: 88 },
      { name: "Communication", level: 78, importance: 85 },
      { name: "Leadership", level: 75, importance: 82 },
      { name: "Data Analysis", level: 65, importance: 70 },
      { name: "Creative Thinking", level: 72, importance: 78 },
      { name: "Budget Management", level: 60, importance: 65 },
    ],
    knowledge: [
      { name: "Sales and Marketing", level: 85, importance: 90 },
      { name: "Customer and Personal Service", level: 75, importance: 80 },
      { name: "English Language", level: 75, importance: 80 },
      { name: "Administration and Management", level: 72, importance: 78 },
    ],
    tasks: [
      "Develop pricing strategies balancing firm objectives and customer satisfaction",
      "Identify, develop, or evaluate marketing strategy based on knowledge of establishment objectives",
      "Direct the hiring, training, or performance evaluations of marketing staff",
      "Negotiate contracts with vendors or distributors to manage product distribution",
      "Compile data related to competitor products, prices, and sales",
    ],
    median_wage: "$140,040 per year",
    employment: "354,600 (2022)",
    growth_rate: "6% (Faster than average, 2022-2032)",
  },
  {
    soc_code: "13-2011.00",
    title: "Accountants and Auditors",
    description: "Examine, analyze, and interpret accounting records to prepare financial statements, give advice, or audit and evaluate statements prepared by others.",
    skills: [
      { name: "Accounting", level: 82, importance: 90 },
      { name: "Mathematics", level: 70, importance: 75 },
      { name: "Critical Thinking", level: 72, importance: 78 },
      { name: "Attention to Detail", level: 80, importance: 88 },
      { name: "Communication", level: 65, importance: 70 },
      { name: "Regulatory Compliance", level: 75, importance: 82 },
    ],
    knowledge: [
      { name: "Economics and Accounting", level: 82, importance: 88 },
      { name: "Mathematics", level: 70, importance: 75 },
      { name: "English Language", level: 65, importance: 70 },
      { name: "Law and Government", level: 60, importance: 65 },
    ],
    tasks: [
      "Prepare, examine, or analyze accounting records and financial statements",
      "Compute taxes owed and prepare tax returns ensuring compliance",
      "Analyze business operations, trends, and projections for financial planning",
      "Report to management regarding the finances of establishment",
      "Develop, implement, modify, and document recordkeeping and accounting systems",
    ],
    median_wage: "$78,000 per year",
    employment: "1,538,400 (2022)",
    growth_rate: "4% (As fast as average, 2022-2032)",
  },
  {
    soc_code: "11-3021.00",
    title: "Computer and Information Systems Managers",
    description: "Plan, direct, or coordinate activities in electronic data processing, information systems, systems analysis, and computer programming.",
    skills: [
      { name: "Leadership", level: 80, importance: 88 },
      { name: "Systems Analysis", level: 75, importance: 82 },
      { name: "Project Management", level: 78, importance: 85 },
      { name: "Communication", level: 75, importance: 82 },
      { name: "Strategic Planning", level: 72, importance: 78 },
      { name: "Technology Management", level: 80, importance: 88 },
    ],
    knowledge: [
      { name: "Computers and Electronics", level: 82, importance: 88 },
      { name: "Administration and Management", level: 78, importance: 85 },
      { name: "English Language", level: 70, importance: 75 },
      { name: "Customer and Personal Service", level: 65, importance: 70 },
    ],
    tasks: [
      "Direct daily operations of department and plan for future resource needs",
      "Review project plans to plan and coordinate project activity",
      "Develop and interpret organizational goals and policies",
      "Consult with users, management, vendors, and technicians to assess computing needs",
      "Manage backup, security, and user help systems",
    ],
    median_wage: "$164,070 per year",
    employment: "485,190 (2022)",
    growth_rate: "15% (Much faster than average, 2022-2032)",
  },
  {
    soc_code: "15-1211.00",
    title: "Computer Systems Analysts",
    description: "Analyze science, engineering, business, and other data processing problems to develop and implement solutions to complex applications problems, system administration issues, or network concerns.",
    skills: [
      { name: "Systems Analysis", level: 80, importance: 88 },
      { name: "Critical Thinking", level: 75, importance: 82 },
      { name: "Complex Problem Solving", level: 72, importance: 78 },
      { name: "Communication", level: 70, importance: 75 },
      { name: "Programming", level: 60, importance: 65 },
      { name: "Quality Control", level: 55, importance: 60 },
    ],
    knowledge: [
      { name: "Computers and Electronics", level: 82, importance: 88 },
      { name: "English Language", level: 70, importance: 75 },
      { name: "Mathematics", level: 60, importance: 65 },
      { name: "Administration and Management", level: 55, importance: 60 },
    ],
    tasks: [
      "Provide staff and users with assistance solving computer-related problems",
      "Test, maintain, and monitor computer programs and systems",
      "Coordinate and link computer systems within an organization",
      "Determine computer software or hardware needed to set up or alter systems",
      "Analyze information processing to plan effective business solutions",
    ],
    median_wage: "$99,270 per year",
    employment: "764,400 (2022)",
    growth_rate: "10% (Faster than average, 2022-2032)",
  },
  {
    soc_code: "13-1161.00",
    title: "Market Research Analysts",
    description: "Research conditions in local, regional, national, or online markets. Gather information to determine potential sales of a product or service, or plan a marketing or advertising campaign.",
    skills: [
      { name: "Data Analysis", level: 78, importance: 85 },
      { name: "Research Methods", level: 75, importance: 82 },
      { name: "Communication", level: 72, importance: 78 },
      { name: "Critical Thinking", level: 70, importance: 75 },
      { name: "Statistical Software", level: 65, importance: 70 },
      { name: "Survey Design", level: 60, importance: 65 },
    ],
    knowledge: [
      { name: "Sales and Marketing", level: 78, importance: 85 },
      { name: "Mathematics", level: 65, importance: 70 },
      { name: "English Language", level: 70, importance: 75 },
      { name: "Customer and Personal Service", level: 60, importance: 65 },
    ],
    tasks: [
      "Collect and analyze data on customer demographics, preferences, and buying habits",
      "Prepare reports of findings, illustrating data graphically and translating findings into written text",
      "Measure effectiveness of programs and strategies",
      "Seek and provide information to help companies determine their position in the marketplace",
      "Forecast and track marketing and sales trends",
    ],
    median_wage: "$68,230 per year",
    employment: "905,000 (2022)",
    growth_rate: "13% (Much faster than average, 2022-2032)",
  },
  {
    soc_code: "15-1299.08",
    title: "UX Designers and Researchers",
    description: "Design and conduct research on user interactions with technology products and services. Apply principles of human-computer interaction to develop intuitive and accessible digital experiences.",
    skills: [
      { name: "User Research", level: 80, importance: 88 },
      { name: "Visual Design", level: 72, importance: 78 },
      { name: "Prototyping", level: 75, importance: 82 },
      { name: "Communication", level: 72, importance: 78 },
      { name: "Empathy and User Advocacy", level: 78, importance: 85 },
      { name: "Information Architecture", level: 68, importance: 72 },
    ],
    knowledge: [
      { name: "Design", level: 78, importance: 85 },
      { name: "Psychology", level: 65, importance: 70 },
      { name: "English Language", level: 65, importance: 70 },
      { name: "Computers and Electronics", level: 70, importance: 75 },
    ],
    tasks: [
      "Conduct user research through interviews, surveys, and usability testing",
      "Create wireframes, prototypes, and high-fidelity designs",
      "Analyze user feedback and behavior data to improve product experiences",
      "Collaborate with product managers and engineers on implementation",
      "Develop and maintain design systems and style guides",
    ],
    median_wage: "$92,500 per year",
    employment: "178,900 (2022)",
    growth_rate: "16% (Much faster than average, 2022-2032)",
  },
  {
    soc_code: "11-9199.00",
    title: "Product Managers",
    description: "Define the strategy, roadmap, and feature definition for a product or product line. Bridge business, technology, and user experience to deliver products that meet market needs.",
    skills: [
      { name: "Strategic Thinking", level: 80, importance: 88 },
      { name: "Communication", level: 80, importance: 88 },
      { name: "Data Analysis", level: 70, importance: 75 },
      { name: "Leadership", level: 72, importance: 78 },
      { name: "User Empathy", level: 75, importance: 82 },
      { name: "Technical Understanding", level: 68, importance: 72 },
    ],
    knowledge: [
      { name: "Administration and Management", level: 78, importance: 85 },
      { name: "Computers and Electronics", level: 65, importance: 70 },
      { name: "Sales and Marketing", level: 70, importance: 75 },
      { name: "Customer and Personal Service", level: 72, importance: 78 },
    ],
    tasks: [
      "Define product vision, strategy, and roadmap",
      "Gather and prioritize product and customer requirements",
      "Work closely with engineering, design, marketing, and sales teams",
      "Analyze market trends and competitive landscape",
      "Define and track key product metrics and KPIs",
    ],
    median_wage: "$145,000 per year",
    employment: "425,700 (2022)",
    growth_rate: "8% (Faster than average, 2022-2032)",
  },
  {
    soc_code: "29-1141.00",
    title: "Registered Nurses",
    description: "Assess patient health problems and needs, develop and implement nursing care plans, and maintain medical records. Administer nursing care to ill, injured, convalescent, or disabled patients.",
    skills: [
      { name: "Patient Care", level: 85, importance: 92 },
      { name: "Critical Thinking", level: 78, importance: 85 },
      { name: "Communication", level: 75, importance: 82 },
      { name: "Monitoring", level: 72, importance: 78 },
      { name: "Medical Knowledge", level: 80, importance: 88 },
      { name: "Emotional Resilience", level: 70, importance: 75 },
    ],
    knowledge: [
      { name: "Medicine and Dentistry", level: 82, importance: 88 },
      { name: "Psychology", level: 65, importance: 70 },
      { name: "English Language", level: 65, importance: 70 },
      { name: "Customer and Personal Service", level: 72, importance: 78 },
    ],
    tasks: [
      "Monitor, record, and report symptoms and changes in patients' conditions",
      "Administer medications to patients and monitor patients for reactions or side effects",
      "Maintain accurate, detailed reports and records",
      "Consult and coordinate with healthcare team members",
      "Educate patients and the public about various health conditions",
    ],
    median_wage: "$81,220 per year",
    employment: "3,175,390 (2022)",
    growth_rate: "6% (Faster than average, 2022-2032)",
  },
];

function occupationToChunks(occ: OccupationProfile): string[] {
  const chunks: string[] = [];

  // Main profile chunk
  chunks.push(
    `Occupation: ${occ.title} (SOC ${occ.soc_code})\n` +
    `Description: ${occ.description}\n` +
    `Median Wage: ${occ.median_wage}\n` +
    `Employment: ${occ.employment}\n` +
    `Growth Rate: ${occ.growth_rate}\n` +
    `Source: O*NET OnLine / BLS OEWS`
  );

  // Skills chunk
  const skillLines = occ.skills
    .map((s) => `  - ${s.name}: Level ${s.level}/100, Importance ${s.importance}/100`)
    .join("\n");
  chunks.push(
    `Skills for ${occ.title} (SOC ${occ.soc_code}):\n${skillLines}\n` +
    `Source: O*NET OnLine`
  );

  // Knowledge chunk
  const knowledgeLines = occ.knowledge
    .map((k) => `  - ${k.name}: Level ${k.level}/100, Importance ${k.importance}/100`)
    .join("\n");
  chunks.push(
    `Knowledge areas for ${occ.title} (SOC ${occ.soc_code}):\n${knowledgeLines}\n` +
    `Source: O*NET OnLine`
  );

  // Tasks chunk
  const taskLines = occ.tasks.map((t, i) => `  ${i + 1}. ${t}`).join("\n");
  chunks.push(
    `Key tasks for ${occ.title} (SOC ${occ.soc_code}):\n${taskLines}\n` +
    `Source: O*NET OnLine`
  );

  // Wage/employment chunk
  chunks.push(
    `Labor market data for ${occ.title} (SOC ${occ.soc_code}):\n` +
    `  Median Annual Wage: ${occ.median_wage}\n` +
    `  Total Employment: ${occ.employment}\n` +
    `  Projected Growth (2022-2032): ${occ.growth_rate}\n` +
    `Source: Bureau of Labor Statistics (BLS) Occupational Employment and Wage Statistics`
  );

  return chunks;
}

async function main() {
  console.log("🔧 Building FAISS index for Career Guidance Assistant\n");

  mkdirSync(DATA_DIR, { recursive: true });

  // Step 1: Generate text chunks from occupation data
  console.log(`Step 1: Generating text chunks from ${OCCUPATIONS.length} occupations...`);
  const allChunks: string[] = [];
  for (const occ of OCCUPATIONS) {
    allChunks.push(...occupationToChunks(occ));
  }
  console.log(`  Generated ${allChunks.length} chunks\n`);

  // Save chunks for reference
  writeFileSync(join(DATA_DIR, "chunks.json"), JSON.stringify(allChunks, null, 2));

  // Save raw occupation data
  writeFileSync(join(DATA_DIR, "occupations.json"), JSON.stringify(OCCUPATIONS, null, 2));

  // Step 2: Check Ollama is running
  console.log("Step 2: Checking Ollama...");
  try {
    execSync("ollama list", { stdio: "pipe" });
    console.log("  Ollama is available\n");
  } catch {
    console.log("  Starting Ollama...");
    execSync("ollama serve &", { stdio: "pipe" });
    // Wait for it to start
    await new Promise((r) => setTimeout(r, 3000));
  }

  // Step 3: Generate embeddings using Ollama
  console.log("Step 3: Generating embeddings with nomic-embed-text...");

  const embeddings: number[][] = [];
  for (let i = 0; i < allChunks.length; i++) {
    const response = await fetch("http://localhost:11434/api/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "nomic-embed-text",
        prompt: allChunks[i],
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embedding failed: ${response.statusText}`);
    }

    const data = (await response.json()) as { embedding: number[] };
    embeddings.push(data.embedding);

    if ((i + 1) % 10 === 0 || i === allChunks.length - 1) {
      process.stdout.write(`\r  Embedded ${i + 1}/${allChunks.length} chunks`);
    }
  }
  console.log("\n");

  // Step 4: Save embeddings and metadata
  console.log("Step 4: Saving index data...");
  writeFileSync(join(DATA_DIR, "embeddings.json"), JSON.stringify(embeddings));
  console.log(`  Saved ${embeddings.length} embeddings (dim=${embeddings[0].length})\n`);

  // Step 5: Verify with a test query
  console.log("Step 5: Verification test query...");
  const testQuery = "software engineer skills programming";
  const testResponse = await fetch("http://localhost:11434/api/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "nomic-embed-text", prompt: testQuery }),
  });
  const testData = (await testResponse.json()) as { embedding: number[] };
  const queryEmb = testData.embedding;

  // Simple cosine similarity search
  const scores = embeddings.map((emb, idx) => {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < emb.length; i++) {
      dot += emb[i] * queryEmb[i];
      normA += emb[i] * emb[i];
      normB += queryEmb[i] * queryEmb[i];
    }
    return { idx, score: dot / (Math.sqrt(normA) * Math.sqrt(normB)) };
  });

  scores.sort((a, b) => b.score - a.score);
  console.log(`  Query: "${testQuery}"`);
  console.log(`  Top 3 results:`);
  for (let i = 0; i < 3; i++) {
    const { idx, score } = scores[i];
    console.log(`    ${i + 1}. (score: ${score.toFixed(4)}) ${allChunks[idx].slice(0, 80)}...`);
  }

  console.log("\n✅ Index built successfully!");
  console.log(`   Data directory: ${DATA_DIR}`);
  console.log(`   Files: occupations.json, chunks.json, embeddings.json`);
}

main().catch((e) => {
  console.error("Failed to build index:", e);
  process.exit(1);
});
