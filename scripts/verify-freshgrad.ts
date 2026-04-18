import { generatePDFReport } from "../src/report/pdf-generator.js";
import { generateHTMLReport } from "../src/report/html-generator.js";
import { computeProximityStats, computeReadinessStats } from "../src/report/report-helpers.js";

const state: any = {
  sessionId: "freshgrad-verify",
  sessionGoal: "explore_options",
  jobTitle: "Business Analyst Intern",
  industry: "Technology",
  yearsExperience: 0,
  educationLevel: "bachelor",
  location: "Indianapolis",
  timeline: "6 months",
  preferredTimeline: "6 months",
  targetRole: "Data Analyst",
  candidateDirections: [
    { direction_title: "Data Analyst", rationale: "User explicitly stated interest in this role." },
  ],
  skills: [
    { skill_name: "Statistical Analysis", required_proficiency: "advanced", user_rating: "intermediate", gap_category: "underdeveloped", skill_type: "technical" },
    { skill_name: "SQL", required_proficiency: "advanced", user_rating: "beginner", gap_category: "absent", skill_type: "technical" },
    { skill_name: "Mathematics", required_proficiency: "advanced", user_rating: "intermediate", gap_category: "underdeveloped", skill_type: "technical" },
    { skill_name: "Machine Learning", required_proficiency: "advanced", user_rating: "beginner", gap_category: "absent", skill_type: "technical" },
    { skill_name: "Critical Thinking", required_proficiency: "advanced", user_rating: "intermediate", gap_category: "underdeveloped", skill_type: "soft" },
    { skill_name: "Complex Problem Solving", required_proficiency: "advanced", user_rating: "intermediate", gap_category: "underdeveloped", skill_type: "soft" },
  ],
  skillsAssessmentStatus: "complete",
  userConfirmedEvaluation: true,
  recommendedPath: "Leverage your Business Analyst Intern experience plus MIS degree into a Data Analyst role.",
  skillDevelopmentAgenda: ["Develop SQL", "Develop Machine Learning", "Strengthen Statistical Analysis"],
  immediateNextSteps: ["Explore learning resources for Mathematics", "Review job postings for Data Analyst", "Connect with Data Analyst professionals"],
  evidenceKept: [],
};

async function main(): Promise<void> {
  const readiness = computeReadinessStats(state.skills);
  const prox = computeProximityStats(state.skills);
  console.log("Readiness:", readiness);
  console.log("Proximity:", prox);
  const pdf = await generatePDFReport(state);
  const html = generateHTMLReport(state);
  console.log("PDF=", pdf);
  console.log("HTML=", html);
}

main().catch((e) => { console.error(e); process.exit(1); });
