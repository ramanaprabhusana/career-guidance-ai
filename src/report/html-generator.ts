import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import type { AgentStateType } from "../state.js";
import { config } from "../config.js";

export function generateHTMLReport(state: AgentStateType): string {
  const outputPath = join(config.paths.root, "exports", `career-plan-${state.sessionId}.html`);
  mkdirSync(join(config.paths.root, "exports"), { recursive: true });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Career Plan Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 40px 20px; }
    h1 { font-size: 28px; color: #1a1a2e; margin-bottom: 8px; text-align: center; }
    .date { text-align: center; color: #666; font-size: 14px; margin-bottom: 32px; }
    .section { margin-bottom: 32px; padding: 24px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #4a90d9; }
    .section h2 { font-size: 18px; color: #1a1a2e; margin-bottom: 12px; }
    .field { margin-bottom: 8px; }
    .field-label { font-weight: 600; color: #555; }
    .skills-table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    .skills-table th, .skills-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e0e0e0; font-size: 14px; }
    .skills-table th { background: #e8eef6; font-weight: 600; color: #333; }
    .gap-absent { color: #d32f2f; font-weight: 600; }
    .gap-underdeveloped { color: #f57c00; font-weight: 600; }
    .gap-strong { color: #388e3c; font-weight: 600; }
    .steps-list { list-style: none; counter-reset: steps; }
    .steps-list li { counter-increment: steps; padding: 8px 0; padding-left: 36px; position: relative; }
    .steps-list li::before { content: counter(steps); position: absolute; left: 0; width: 24px; height: 24px; background: #4a90d9; color: white; border-radius: 50%; text-align: center; line-height: 24px; font-size: 12px; font-weight: 600; }
    .agenda-list { list-style: disc; padding-left: 24px; }
    .agenda-list li { padding: 4px 0; }
    .sources { font-size: 13px; color: #666; }
    .sources ul { list-style: disc; padding-left: 24px; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0; text-align: center; font-size: 12px; color: #999; }
    @media print { body { max-width: none; } .section { break-inside: avoid; } }
  </style>
</head>
<body>
  <h1>Career Plan Report</h1>
  <p class="date">Generated: ${new Date().toLocaleDateString()}</p>

  <div class="section" role="region" aria-label="Profile Summary">
    <h2>1. Profile Summary</h2>
    <div class="field"><span class="field-label">Current/Recent Role:</span> ${esc(state.jobTitle ?? "Not provided")}</div>
    <div class="field"><span class="field-label">Industry:</span> ${esc(state.industry ?? "Not provided")}</div>
    <div class="field"><span class="field-label">Years of Experience:</span> ${state.yearsExperience !== null ? `${state.yearsExperience} years` : "Not provided"}</div>
    <div class="field"><span class="field-label">Education:</span> ${esc(fmtEdu(state.educationLevel))}</div>
    <div class="field"><span class="field-label">Goal:</span> ${state.sessionGoal === "explore_options" ? "Explore career options" : "Pursue a specific role"}</div>
    ${state.targetRole ? `<div class="field"><span class="field-label">Target Role:</span> ${esc(state.targetRole)}</div>` : ""}
  </div>

  <div class="section" role="region" aria-label="Recommended Path">
    <h2>2. Recommended Career Path</h2>
    <p>${state.recommendedPath ? esc(state.recommendedPath) : state.targetRole ? esc(`Your target role is ${state.targetRole}. A detailed recommended path could not be generated because the skills assessment was not completed. Complete the skills assessment to receive a personalized career path recommendation.`) : esc("A recommended career path could not be generated for this session. Complete a full career coaching session including skills assessment to receive personalized recommendations.")}</p>
  </div>

  <div class="section" role="region" aria-label="Skill Gap Analysis">
    <h2>3. Skill Gap Analysis</h2>
    ${state.skills.length > 0 ? `
    <table class="skills-table" role="table" aria-label="Skills assessment results">
      <thead>
        <tr><th>Skill</th><th>Required Level</th><th>Your Level</th><th>Gap Status</th></tr>
      </thead>
      <tbody>
        ${state.skills.map((s) => `
        <tr>
          <td>${esc(s.skill_name)}</td>
          <td>${esc(s.required_proficiency || "-")}</td>
          <td>${fmtRating(s.user_rating)}</td>
          <td class="gap-${s.gap_category ?? "unknown"}">${fmtGap(s.gap_category)}</td>
        </tr>`).join("")}
      </tbody>
    </table>` : `<p>${esc(
      (state as any).skillsAssessmentStatus === "skipped"
        ? "Skills assessment was not completed during this session. The session reached its turn limit before skills could be evaluated. To get a full skill gap analysis, start a new session and complete the skills assessment phase."
        : !state.targetRole
        ? "No target role was specified during this session, so skills could not be assessed against role requirements. To get a skill gap analysis, start a new session and specify a target role."
        : "Skills assessment was not completed during this session. To get a full skill gap analysis, continue your session or start a new one focused on your target role."
    )}</p>`}
  </div>

  <div class="section" role="region" aria-label="Development Timeline">
    <h2>4. Development Timeline</h2>
    <p><strong>Estimated timeline:</strong> ${esc(state.timeline ?? "To be determined")}</p>
    ${state.skillDevelopmentAgenda.length > 0 ? `
    <h3 style="margin-top: 12px; font-size: 15px;">Skill Development Priorities</h3>
    <ul class="agenda-list">
      ${state.skillDevelopmentAgenda.map((item) => `<li>${esc(item)}</li>`).join("")}
    </ul>` : ""}
  </div>

  <div class="section" role="region" aria-label="Immediate Next Steps">
    <h2>5. Immediate Next Steps</h2>
    ${state.immediateNextSteps.length > 0 ? `
    <ol class="steps-list">
      ${state.immediateNextSteps.map((step) => `<li>${esc(step)}</li>`).join("")}
    </ol>` : state.targetRole ? `<ol class="steps-list">
      <li>${esc(`Research job postings for ${state.targetRole} to understand current requirements`)}</li>
      <li>Complete a full career coaching session including skills assessment</li>
      <li>Connect with professionals in your target field for informational interviews</li>
    </ol>` : "<p>Complete a full career coaching session to receive personalized next steps.</p>"}
  </div>

  <div class="section sources" role="region" aria-label="Evidence and Sources">
    <h2>6. Evidence & Sources</h2>
    <p>Data sources used in this analysis:</p>
    <ul>
      <li>O*NET OnLine - Occupational skill and task requirements (U.S. Department of Labor)</li>
      <li>Bureau of Labor Statistics (BLS) - Occupational Employment and Wage Statistics</li>
      <li>USAJOBS - Federal government job postings</li>
    </ul>
    ${state.planRationale ? `<p style="margin-top: 12px; font-style: italic;">${esc(state.planRationale)}</p>` : ""}
  </div>

  <div class="footer" role="contentinfo">
    <p>Generated by Career Guidance Assistant. This report is for informational purposes only.</p>
    <p>Career outcomes depend on many factors. Consult with a professional career advisor for personalized guidance.</p>
  </div>
</body>
</html>`;

  writeFileSync(outputPath, html, "utf-8");
  return outputPath;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtEdu(level: string | null): string {
  const m: Record<string, string> = { high_school: "High School Diploma", associate: "Associate's Degree", bachelor: "Bachelor's Degree", master: "Master's Degree", doctoral: "Doctoral Degree", other: "Other" };
  return level ? m[level] ?? level : "Not provided";
}

function fmtRating(r: string | null): string {
  const m: Record<string, string> = { not_yet_familiar: "New", working_knowledge: "Intermediate", strong_proficiency: "Strong" };
  return r ? m[r] ?? r : "-";
}

function fmtGap(g: string | null): string {
  const m: Record<string, string> = { absent: "Needs Development", underdeveloped: "Needs Growth", strong: "On Track" };
  return g ? m[g] ?? g : "-";
}
