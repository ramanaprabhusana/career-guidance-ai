import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import type { AgentStateType, SkillAssessment } from "../state.js";
import { config } from "../config.js";
import { blendSkillsAcrossRoles, categorizeSkillType } from "../utils/rag.js";

export function generateHTMLReport(state: AgentStateType): string {
  const outputPath = join(config.paths.root, "exports", `career-plan-${state.sessionId}.html`);
  mkdirSync(join(config.paths.root, "exports"), { recursive: true });

  const isExplore = state.sessionGoal === "explore_options";
  const directions = state.candidateDirections ?? [];
  const candidateSkills = (state as any).candidateSkills ?? {};
  const skills = (state.skills ?? []).map(s => ({
    ...s,
    skill_type: s.skill_type ?? categorizeSkillType(s.skill_name),
  }));
  const techSkills = skills.filter(s => s.skill_type === "technical");
  const softSkills = skills.filter(s => s.skill_type === "soft");
  const timeline = state.timeline ?? "to be determined";

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
    .section h3 { font-size: 15px; color: #333; margin: 16px 0 8px; }
    .field { margin-bottom: 8px; }
    .field-label { font-weight: 600; color: #555; }
    .skills-table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    .skills-table th, .skills-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e0e0e0; font-size: 14px; }
    .skills-table th { background: #e8eef6; font-weight: 600; color: #333; }
    .gap-absent { color: #d32f2f; font-weight: 600; }
    .gap-underdeveloped { color: #f57c00; font-weight: 600; }
    .gap-strong { color: #388e3c; font-weight: 600; }
    .direction-list { list-style: none; counter-reset: dirs; margin: 12px 0; }
    .direction-list li { counter-increment: dirs; padding: 12px 0 12px 40px; position: relative; border-bottom: 1px solid #eee; }
    .direction-list li::before { content: counter(dirs); position: absolute; left: 0; width: 28px; height: 28px; background: #4a90d9; color: white; border-radius: 50%; text-align: center; line-height: 28px; font-size: 14px; font-weight: 600; }
    .direction-title { font-weight: 600; font-size: 15px; color: #1a1a2e; }
    .direction-rationale { font-size: 13px; color: #666; margin-top: 4px; }
    .steps-list { list-style: none; counter-reset: steps; }
    .steps-list li { counter-increment: steps; padding: 8px 0; padding-left: 36px; position: relative; }
    .steps-list li::before { content: counter(steps); position: absolute; left: 0; width: 24px; height: 24px; background: #4a90d9; color: white; border-radius: 50%; text-align: center; line-height: 24px; font-size: 12px; font-weight: 600; }
    .agenda-list { list-style: disc; padding-left: 24px; }
    .agenda-list li { padding: 4px 0; }
    .note { background: #fff8e1; border-left: 3px solid #f9a825; padding: 12px 16px; margin: 16px 0; font-size: 13px; line-height: 1.7; border-radius: 4px; }
    .course-hint { font-size: 13px; color: #555; font-style: italic; margin-top: 4px; }
    .skill-tag { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; margin-left: 6px; }
    .skill-tag.technical { background: #e3f2fd; color: #1565c0; }
    .skill-tag.soft { background: #f3e5f5; color: #7b1fa2; }
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

${renderSection2(state, isExplore, directions, candidateSkills, skills, techSkills, softSkills)}

${renderSection3(state, isExplore, skills, techSkills, softSkills, timeline, candidateSkills)}

  <div class="section" role="region" aria-label="Development Timeline">
    <h2>4. Development Timeline</h2>
    <p><strong>Estimated timeline:</strong> ${esc(timeline)}</p>
    ${state.skillDevelopmentAgenda.length > 0 ? `
    <h3>Skill Development Priorities</h3>
    <ul class="agenda-list">
      ${state.skillDevelopmentAgenda.map((item) => `<li>${esc(item)}</li>`).join("")}
    </ul>` : ""}
  </div>

  <div class="section" role="region" aria-label="Suggested Next Steps">
    <h2>5. Suggested Next Steps</h2>
    ${state.immediateNextSteps.length > 0 ? `
    <ol class="steps-list">
      ${state.immediateNextSteps.map((step) => `<li>${esc(softenStep(step))}</li>`).join("")}
    </ol>` : isExplore && directions.length > 0 ? `
    <ol class="steps-list">
      <li>You might consider researching job postings for ${esc(directions[0].direction_title)} to understand current market expectations</li>
      <li>It could be helpful to connect with professionals in these fields for informational conversations</li>
      <li>You may find it valuable to start a focused session for your top-choice role to get a detailed skill gap analysis</li>
    </ol>` : `<p>Complete a full career coaching session to receive personalized recommendations.</p>`}
  </div>

  <div class="footer" role="contentinfo">
    <p>Generated by Career Guidance Assistant. This report is for informational purposes only.</p>
    <p>Career outcomes depend on many factors. Consider consulting with a professional career advisor for personalized guidance.</p>
  </div>
</body>
</html>`;

  writeFileSync(outputPath, html, "utf-8");
  return outputPath;
}

// --- Section Renderers ---

function renderSection2(
  state: AgentStateType,
  isExplore: boolean,
  directions: AgentStateType["candidateDirections"],
  candidateSkills: Record<string, SkillAssessment[]>,
  skills: SkillAssessment[],
  techSkills: SkillAssessment[],
  softSkills: SkillAssessment[],
): string {
  if (isExplore && directions.length > 0) {
    // Explore track: ranked directions + blended skills
    const blended = blendSkillsAcrossRoles(candidateSkills, 5);
    return `
  <div class="section" role="region" aria-label="Recommended Career Path">
    <h2>2. Recommended Career Directions</h2>
    <p>Based on your background and interests, the following career directions may be a strong fit:</p>
    <ol class="direction-list">
      ${directions.map((d) => `
      <li>
        <div class="direction-title">${esc(d.direction_title)}</div>
        <div class="direction-rationale">${esc(d.rationale)}</div>
      </li>`).join("")}
    </ol>
    ${blended.length > 0 ? `
    <h3>Key Skills Across These Paths</h3>
    <p style="font-size: 13px; color: #666; margin-bottom: 8px;">These skills appear frequently across your recommended directions and could give you leverage in pursuing any of them:</p>
    <table class="skills-table">
      <thead><tr><th>Skill</th><th>Type</th><th>Typical Proficiency Level</th></tr></thead>
      <tbody>
        ${blended.map((s) => `
        <tr>
          <td>${esc(s.skill_name)}</td>
          <td><span class="skill-tag ${s.skill_type}">${s.skill_type}</span></td>
          <td>${esc(s.required_proficiency || "-")}</td>
        </tr>`).join("")}
      </tbody>
    </table>` : ""}
  </div>`;
  }

  if (state.targetRole && skills.length > 0) {
    // Specific role track: target role + tech/soft skill tables
    const topTech = techSkills.slice(0, 5);
    const topSoft = softSkills.slice(0, 5);
    return `
  <div class="section" role="region" aria-label="Recommended Career Path">
    <h2>2. Recommended Career Path</h2>
    <p><strong>Target Role:</strong> ${esc(state.targetRole)}</p>
    <p>${esc(state.recommendedPath ?? "")}</p>
    ${topTech.length > 0 ? `
    <h3>Top Technical Skills for ${esc(state.targetRole)}</h3>
    <table class="skills-table">
      <thead><tr><th>Skill</th><th>Required Level</th><th>Your Level</th></tr></thead>
      <tbody>
        ${topTech.map((s) => `
        <tr>
          <td>${esc(s.skill_name)}</td>
          <td>${esc(s.required_proficiency || "-")}</td>
          <td>${fmtRating(s.user_rating)}</td>
        </tr>`).join("")}
      </tbody>
    </table>` : ""}
    ${topSoft.length > 0 ? `
    <h3>Top Soft Skills for ${esc(state.targetRole)}</h3>
    <table class="skills-table">
      <thead><tr><th>Skill</th><th>Required Level</th><th>Your Level</th></tr></thead>
      <tbody>
        ${topSoft.map((s) => `
        <tr>
          <td>${esc(s.skill_name)}</td>
          <td>${esc(s.required_proficiency || "-")}</td>
          <td>${fmtRating(s.user_rating)}</td>
        </tr>`).join("")}
      </tbody>
    </table>` : ""}
  </div>`;
  }

  // Fallback
  return `
  <div class="section" role="region" aria-label="Recommended Career Path">
    <h2>2. Recommended Career Path</h2>
    <p>${esc(state.recommendedPath ?? "A recommended career path could not be generated for this session. Complete a full career coaching session to receive personalized recommendations.")}</p>
  </div>`;
}

function renderSection3(
  state: AgentStateType,
  isExplore: boolean,
  skills: SkillAssessment[],
  techSkills: SkillAssessment[],
  softSkills: SkillAssessment[],
  timeline: string,
  candidateSkills: Record<string, SkillAssessment[]>,
): string {
  if (!isExplore && skills.length > 0) {
    // Specific role: tech/soft gap tables with actionables
    const techGaps = techSkills.filter(s => s.gap_category === "absent" || s.gap_category === "underdeveloped");
    const softGaps = softSkills.filter(s => s.gap_category === "absent" || s.gap_category === "underdeveloped");

    return `
  <div class="section" role="region" aria-label="Skill Gap Analysis">
    <h2>3. Skill Gap Analysis</h2>
    ${techSkills.length > 0 ? `
    <h3>Technical Skills</h3>
    <table class="skills-table">
      <thead><tr><th>Skill</th><th>Required</th><th>Your Level</th><th>Gap</th><th>Suggested Action</th></tr></thead>
      <tbody>
        ${techSkills.map((s) => `
        <tr>
          <td>${esc(s.skill_name)}</td>
          <td>${esc(s.required_proficiency || "-")}</td>
          <td>${fmtRating(s.user_rating)}</td>
          <td class="gap-${s.gap_category ?? "unknown"}">${fmtGap(s.gap_category)}</td>
          <td>${esc(suggestTechAction(s, timeline))}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    ${techGaps.length > 0 ? `<p class="course-hint">For technical skill gaps, you might explore free resources on YouTube and freeCodeCamp first, then consider structured courses on Coursera or edX as your learning progresses within your ${esc(timeline)} timeline.</p>` : ""}` : ""}
    ${softSkills.length > 0 ? `
    <h3>Soft Skills</h3>
    <table class="skills-table">
      <thead><tr><th>Skill</th><th>Required</th><th>Your Level</th><th>Gap</th><th>Suggested Action</th></tr></thead>
      <tbody>
        ${softSkills.map((s) => `
        <tr>
          <td>${esc(s.skill_name)}</td>
          <td>${esc(s.required_proficiency || "-")}</td>
          <td>${fmtRating(s.user_rating)}</td>
          <td class="gap-${s.gap_category ?? "unknown"}">${fmtGap(s.gap_category)}</td>
          <td>${esc(suggestSoftAction(s))}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    <div class="note">
      <strong>A note on soft skills:</strong> Many interpersonal and leadership skills develop most effectively through hands-on experience, mentoring, and real-world practice rather than formal coursework alone. While workshops and online resources can provide frameworks and techniques, the depth of these skills often comes from consistently applying them in professional settings. Consider seeking out projects, volunteer roles, or workplace opportunities that let you practice these skills regularly.
    </div>` : ""}
  </div>`;
  }

  // Explore track or empty skills
  const blended = blendSkillsAcrossRoles(candidateSkills, 5);
  return `
  <div class="section" role="region" aria-label="Skill Gap Analysis">
    <h2>3. Skill Gap Analysis</h2>
    ${blended.length > 0 ? `
    <p>Since you are exploring multiple career directions, a detailed personalized gap analysis will be available once you select a specific target role. Below are cross-cutting skills that could strengthen your candidacy across all recommended paths:</p>
    <table class="skills-table">
      <thead><tr><th>Skill</th><th>Type</th><th>Typical Proficiency Level</th></tr></thead>
      <tbody>
        ${blended.map((s) => `
        <tr>
          <td>${esc(s.skill_name)}</td>
          <td><span class="skill-tag ${s.skill_type}">${s.skill_type}</span></td>
          <td>${esc(s.required_proficiency || "-")}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    <p style="font-size: 13px; color: #666; margin-top: 12px;">To get a personalized gap analysis with self-assessment ratings and specific course recommendations, you might consider starting a new session focused on one of the career directions listed above.</p>` : `
    <p>${esc(
      !state.targetRole
        ? "No target role was specified during this session, so skills could not be assessed against role requirements. To get a skill gap analysis, consider starting a new session and specifying a target role."
        : "Skills assessment was not completed during this session. To get a full skill gap analysis, consider continuing your session or starting a new one."
    )}</p>`}
  </div>`;
}

// --- Helpers ---

function suggestTechAction(skill: SkillAssessment, timeline: string): string {
  if (skill.gap_category === "absent") {
    return `Consider starting with free tutorials and introductory courses`;
  }
  if (skill.gap_category === "underdeveloped") {
    return `Consider intermediate-level practice projects or structured courses`;
  }
  return "Continue building on this strength";
}

function suggestSoftAction(skill: SkillAssessment): string {
  if (skill.gap_category === "absent") {
    return "Seek opportunities to practice in team settings or projects";
  }
  if (skill.gap_category === "underdeveloped") {
    return "Look for mentoring or leadership opportunities to develop further";
  }
  return "Continue applying this strength in your work";
}

function softenStep(step: string): string {
  if (/^(you might|it could|you may|consider)/i.test(step)) return step;
  return step
    .replace(/^Research /i, "You might consider researching ")
    .replace(/^Review /i, "It could be helpful to review ")
    .replace(/^Connect /i, "You may find it valuable to connect ")
    .replace(/^Explore /i, "You might consider exploring ")
    .replace(/^Start /i, "Consider starting ")
    .replace(/^Take /i, "You might consider taking ");
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
