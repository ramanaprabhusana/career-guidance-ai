import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import type { AgentStateType, SkillAssessment } from "../state.js";
import { config } from "../config.js";
import { blendSkillsAcrossRoles, categorizeSkillType } from "../utils/rag.js";
import { getDisplayRole, computeReadinessStats, computeProximityStats } from "./report-helpers.js";

export function generateHTMLReport(state: AgentStateType): string {
  const outputPath = join(config.paths.root, "exports", `career-plan-${state.sessionId}.html`);
  mkdirSync(join(config.paths.root, "exports"), { recursive: true });

  const hasAssessedRole = Boolean(state.targetRole) && (state.skills ?? []).length > 0;
  const isExplore = state.sessionGoal === "explore_options" && !hasAssessedRole;
  const directions = ((): AgentStateType["candidateDirections"] => {
    const seen = new Set<string>();
    const out: AgentStateType["candidateDirections"] = [];
    for (const d of state.candidateDirections ?? []) {
      const key = (d.direction_title ?? "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(d);
    }
    return out;
  })();
  const candidateSkills = (state as any).candidateSkills ?? {};
  const skills = (state.skills ?? []).map(s => ({
    ...s,
    skill_type: s.skill_type ?? categorizeSkillType(s.skill_name),
  }));
  const techSkills = skills.filter(s => s.skill_type === "technical");
  const softSkills = skills.filter(s => s.skill_type === "soft");
  const timeline = state.timeline ?? "to be determined";
  const location = (state as any).location ?? null;

  // Progress calculations
  // Change 5 P0 (Apr 14 2026): separate assessment-completion from strength.
  // `Tech Ready`/`Soft Ready` was misleading — it showed 0% whenever skills
  // were still developing even after 100% were rated (see Apr 12 transcript).
  const stats = computeReadinessStats(skills);
  const proximity = computeProximityStats(skills);
  const totalSkills = stats.totalSkills;
  const ratedSkills = stats.assessedSkills;
  const strongSkills = stats.strongSkills;
  const gapSkills = stats.gapSkills;
  const assessmentPct = stats.assessmentPct;
  const techProgressPct = proximity.techProgressPct;
  const softProgressPct = proximity.softProgressPct;
  const techStrengthPct = techSkills.length > 0 ? Math.round((techSkills.filter(s => s.gap_category === "strong").length / techSkills.length) * 100) : 0;
  const softStrengthPct = softSkills.length > 0 ? Math.round((softSkills.filter(s => s.gap_category === "strong").length / softSkills.length) * 100) : 0;
  const displayRole = getDisplayRole(state);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Career Development Plan${displayRole ? ` - ${esc(displayRole)}` : (state.jobTitle ? ` - ${esc(state.jobTitle)}` : "")}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@700;900&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    /* Pastel shell inspired by onboarding checklist templates */
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; line-height: 1.6; color: #3d3d3d; background: #fdf0f3; }

    .top-accent { height: 8px; background: #2a9d8f; width: 100%; }
    /* === Header Banner (blend: GBH teal bar + L&D hero) === */
    .report-header { background: linear-gradient(165deg, #fff 0%, #fef6f8 45%, #fce8ee 100%); color: #2c2c2c; padding: 28px 0 8px; position: relative; border-bottom: 1px solid #f0d0d8; }
    .header-content { max-width: 960px; margin: 0 auto; padding: 0 32px; display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; flex-wrap: wrap; }
    .header-left h1 { font-family: 'Merriweather', Georgia, serif; font-size: 2rem; font-weight: 900; color: #c94c4c; margin-bottom: 8px; letter-spacing: -0.02em; }
    .header-left .subtitle { font-size: 14px; color: #6b6b6b; margin-bottom: 14px; max-width: 420px; }
    .header-badges { display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
    .badge-goal { background: #fff3cd; border: 1px solid #e8b931; color: #8a6d00; }
    .badge-track { background: #e8f4fc; border: 1px solid #7eb8da; color: #1a5270; }
    .badge-role { background: #e8f8ef; border: 1px solid #52c97f; color: #1e6b3d; }

    /* L&D style progress cards */
    .progress-cards { display: flex; gap: 10px; margin-top: 4px; flex-wrap: wrap; }
    .progress-card { background: #fff; border-radius: 14px; padding: 12px 16px; min-width: 108px; text-align: center; border: 1px solid #ead5dc; box-shadow: 0 2px 8px rgba(180,120,140,0.12); }
    .progress-card .pct { font-size: 26px; font-weight: 800; }
    .progress-card .pct-label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.06em; }
    .pct-tech { color: #2874a6; }
    .pct-soft { color: #7d3c98; }
    .pct-overall { color: #c94c4c; }

    /* === Profile card inside orange section === */
    .sec-profile .profile-card { background: #fffefb; border-radius: 12px; padding: 20px 22px; border: 1px solid #f5e6d8; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 18px; }
    .profile-item { }
    .profile-item .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: #a0aec0; font-weight: 600; margin-bottom: 4px; }
    .profile-item .value { font-size: 14px; font-weight: 600; color: #2d3748; }

    /* === Main Content === */
    .main { max-width: 960px; margin: 28px auto 40px; padding: 0 32px; }

    /* === Section: rounded banner (Stark orientation style) === */
    .section { margin-bottom: 32px; background: #fff; border-radius: 16px; overflow: hidden; border: 1px solid #edd5dc; box-shadow: 0 3px 18px rgba(150,100,115,0.08); }
    .section-header { padding: 14px 22px 14px 20px; font-size: 15px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 12px; border-radius: 0 50px 50px 0; margin: 18px 0 0 0; max-width: calc(100% - 24px); }
    .section-header .icon { width: 36px; height: 36px; border-radius: 50%; background: rgba(255,255,255,0.25); display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; }
    .section-body { padding: 22px 26px 26px; }

    .sec-profile .section-header { background: linear-gradient(90deg, #e67e22, #f39c12); }
    .sec-path .section-header { background: linear-gradient(90deg, #27ae60, #58d68d); }
    .sec-skills .section-header { background: linear-gradient(90deg, #2874a6, #5dade2); }
    .sec-timeline .section-header { background: linear-gradient(90deg, #6c3483, #a569bd); }
    .sec-steps .section-header { background: linear-gradient(90deg, #c0392b, #e74c3c); }
    .sec-evidence .section-header { background: linear-gradient(90deg, #117a65, #2a9d8f); }

    /* === Category Pill Tags === */
    .cat-pill { display: inline-block; padding: 3px 12px; border-radius: 14px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .cat-tech { background: #ebf5fb; color: #2471a3; border: 1px solid #aed6f1; }
    .cat-soft { background: #f5eef8; color: #7d3c98; border: 1px solid #d2b4de; }

    /* === Two-Column Grid === */
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    @media (max-width: 700px) { .two-col { grid-template-columns: 1fr; } }

    /* === Skill Category Card === */
    .skill-cat-card { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
    .skill-cat-header { padding: 12px 18px; font-weight: 700; font-size: 14px; display: flex; align-items: center; justify-content: space-between; }
    .skill-cat-header.tech-header { background: #ebf5fb; color: #2471a3; border-bottom: 2px solid #aed6f1; }
    .skill-cat-header.soft-header { background: #f5eef8; color: #7d3c98; border-bottom: 2px solid #d2b4de; }
    .skill-cat-body { padding: 0; }

    /* === Progress Bars === */
    .progress-bar-wrap { width: 100%; height: 8px; background: #edf2f7; border-radius: 4px; overflow: hidden; margin-top: 6px; }
    .progress-bar-fill { height: 100%; border-radius: 4px; transition: width 0.5s ease; }
    .fill-strong { background: linear-gradient(90deg, #27ae60, #2ecc71); }
    .fill-partial { background: linear-gradient(90deg, #f39c12, #f1c40f); }
    .fill-gap { background: linear-gradient(90deg, #e74c3c, #c0392b); }
    .fill-tech { background: linear-gradient(90deg, #2980b9, #5dade2); }
    .fill-soft { background: linear-gradient(90deg, #8e44ad, #c39bd3); }

    /* === Skills Table === */
    .skills-table { width: 100%; border-collapse: collapse; }
    .skills-table th { padding: 10px 14px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #718096; font-weight: 600; border-bottom: 2px solid #e2e8f0; }
    .skills-table td { padding: 10px 14px; font-size: 13px; border-bottom: 1px solid #f0f0f0; }
    .skills-table tr:last-child td { border-bottom: none; }
    .gap-absent { color: #e74c3c; font-weight: 600; }
    .gap-underdeveloped { color: #f39c12; font-weight: 600; }
    .gap-strong { color: #27ae60; font-weight: 600; }

    /* === Checklist Items (inspired by orientation checklist) === */
    .checklist { list-style: none; }
    .checklist li { display: flex; align-items: flex-start; gap: 12px; padding: 12px 0; border-bottom: 1px solid #f0f0f0; }
    .checklist li:last-child { border-bottom: none; }
    .check-circle { width: 22px; height: 22px; border-radius: 50%; border: 2px solid #cbd5e0; flex-shrink: 0; margin-top: 2px; display: flex; align-items: center; justify-content: center; }
    .check-circle.done { background: #27ae60; border-color: #27ae60; }
    .check-circle.done::after { content: '\\2713'; color: white; font-size: 12px; font-weight: 700; }
    .check-text { font-size: 14px; line-height: 1.5; }

    /* === Direction Cards (inspired by L&D plan categories) === */
    .direction-card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin-bottom: 16px; position: relative; border-left: 5px solid; }
    .direction-card:nth-child(1) { border-left-color: #e8b931; }
    .direction-card:nth-child(2) { border-left-color: #e67e22; }
    .direction-card:nth-child(3) { border-left-color: #e74c3c; }
    .direction-card:nth-child(4) { border-left-color: #9b59b6; }
    .direction-num { position: absolute; top: -12px; left: 16px; width: 28px; height: 28px; border-radius: 50%; color: white; font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
    .direction-card:nth-child(1) .direction-num { background: #e8b931; }
    .direction-card:nth-child(2) .direction-num { background: #e67e22; }
    .direction-card:nth-child(3) .direction-num { background: #e74c3c; }
    .direction-card:nth-child(4) .direction-num { background: #9b59b6; }
    .direction-title { font-size: 16px; font-weight: 700; color: #1a1a2e; margin-bottom: 4px; }
    .direction-rationale { font-size: 13px; color: #718096; line-height: 1.6; }

    /* === GBH-style IDP steps (icon + rounded bar + body) === */
    .idp-steps { display: flex; flex-direction: column; gap: 26px; margin-top: 10px; }
    .idp-step { display: flex; gap: 18px; align-items: flex-start; }
    .idp-icon-circle {
      width: 56px; height: 56px; border-radius: 50%; border: 4px solid #ccc; display: flex; align-items: center; justify-content: center;
      font-size: 22px; background: #fff; flex-shrink: 0;
    }
    .idp-s1 .idp-icon-circle { border-color: #e67e22; }
    .idp-s2 .idp-icon-circle { border-color: #27ae60; }
    .idp-s3 .idp-icon-circle { border-color: #1abc9c; }
    .idp-s4 .idp-icon-circle { border-color: #2874a6; }
    .idp-s5 .idp-icon-circle { border-color: #6c3483; }
    .idp-step-wrap { flex: 1; min-width: 0; }
    .idp-step-bar { padding: 10px 16px; border-radius: 10px 10px 0 0; color: #fff; font-weight: 700; font-size: 13px; }
    .idp-s1 .idp-step-bar { background: linear-gradient(90deg, #e67e22, #f39c12); }
    .idp-s2 .idp-step-bar { background: linear-gradient(90deg, #27ae60, #58d68d); }
    .idp-s3 .idp-step-bar { background: linear-gradient(90deg, #16a085, #48c9b0); }
    .idp-s4 .idp-step-bar { background: linear-gradient(90deg, #2874a6, #5dade2); }
    .idp-s5 .idp-step-bar { background: linear-gradient(90deg, #6c3483, #a569bd); }
    .idp-step-body {
      background: #f4f4f6; padding: 14px 16px; border-radius: 0 0 10px 10px; border: 1px solid #e4e4e8; border-top: none;
      font-size: 14px; color: #4a5568; line-height: 1.55;
    }

    /* === New-hire style 5-day grid for next steps === */
    .week-plan-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    @media (max-width: 700px) { .week-plan-grid { grid-template-columns: 1fr; } }
    .day-card { border-radius: 14px; overflow: hidden; border: 1px solid #edd5dc; background: #fff; }
    .day-card .day-header {
      font-family: 'Merriweather', Georgia, serif; font-size: 14px; font-weight: 700; color: #fff; padding: 10px 16px;
    }
    .day-a .day-header { background: linear-gradient(90deg, #e57373, #ec7063); }
    .day-b .day-header { background: linear-gradient(90deg, #7986cb, #9fa8da); }
    .day-a .day-list { border-left: 4px solid #e57373; margin-left: 0; }
    .day-b .day-list { border-left: 4px solid #7986cb; margin-left: 0; }
    .day-list { list-style: none; margin: 0; padding: 12px 14px 14px 18px; }
    .day-list li { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-bottom: 1px solid #f0eef2; }
    .day-list li:last-child { border-bottom: none; }
    .day-list .check-circle { width: 18px; height: 18px; margin-top: 3px; }
    .day-placeholder { font-size: 13px; color: #9ca3af; font-style: italic; padding: 8px 0 !important; border: none !important; }

    /* === Action Items (New Hire Checklist style) === */
    .action-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 700px) { .action-grid { grid-template-columns: 1fr; } }
    .action-item { display: flex; gap: 10px; align-items: flex-start; padding: 12px 16px; background: #f7fafc; border-radius: 8px; border: 1px solid #e2e8f0; }
    .action-bullet { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 6px; }

    /* === Note Box === */
    .note-box { background: #fffbeb; border: 1px solid #fcd34d; border-left: 4px solid #f59e0b; padding: 16px 20px; border-radius: 8px; margin: 16px 0; font-size: 13px; line-height: 1.7; }
    .note-box strong { color: #92400e; }

    /* === Footer === */
    .footer { max-width: 960px; margin: 40px auto; padding: 20px 32px; text-align: center; font-size: 12px; color: #a0aec0; border-top: 1px solid #e2e8f0; }

    @media print {
      body { background: white; }
      .section { break-inside: avoid; box-shadow: none; border: 1px solid #e2e8f0; }
      .report-header, .section-header, .idp-step-bar, .day-card .day-header, .top-accent, .profile-card {
        print-color-adjust: exact; -webkit-print-color-adjust: exact;
      }
    }
  </style>
</head>
<body>
  <div class="top-accent" aria-hidden="true"></div>

  <!-- ===== HEADER BANNER (L&D style hero + progress) ===== -->
  <div class="report-header">
    <div class="header-content">
      <div class="header-left">
        <h1>Career Development Plan</h1>
        <p class="subtitle">Personalized guidance report | ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
        <div class="header-badges">
          <span class="badge badge-goal">${isExplore ? "Exploring Options" : "Specific Role"}</span>
          ${displayRole ? `<span class="badge badge-role">${esc(displayRole)}</span>` : ""}
          ${location ? `<span class="badge badge-track">${esc(location)}</span>` : ""}
        </div>
      </div>
      ${totalSkills > 0 ? `
      <div class="progress-cards">
        <div class="progress-card">
          <div class="pct pct-overall">${assessmentPct}%</div>
          <div class="pct-label">Assessed</div>
        </div>
        <div class="progress-card">
          <div class="pct pct-tech">${techProgressPct}%</div>
          <div class="pct-label">Tech Progress</div>
        </div>
        <div class="progress-card">
          <div class="pct pct-soft">${softProgressPct}%</div>
          <div class="pct-label">Soft Progress</div>
        </div>
      </div>` : ""}
    </div>
  </div>

  <div class="main">
  <!-- ===== PROFILE (Stark-style pre-arrival snapshot) ===== -->
  <div class="section sec-profile">
    <div class="section-header"><div class="icon">&#128100;</div> Your career snapshot</div>
    <div class="section-body">
      <div class="profile-card">
        <div class="profile-item"><div class="label">Current Role</div><div class="value">${esc(state.jobTitle ?? "Not provided")}</div></div>
        <div class="profile-item"><div class="label">Industry</div><div class="value">${esc(state.industry ?? "Not provided")}</div></div>
        <div class="profile-item"><div class="label">Experience</div><div class="value">${state.yearsExperience !== null ? `${state.yearsExperience} years` : "Not provided"}</div></div>
        <div class="profile-item"><div class="label">Education</div><div class="value">${esc(fmtEdu(state.educationLevel))}</div></div>
        ${state.location ? `<div class="profile-item"><div class="label">Location</div><div class="value">${esc(state.location)}</div></div>` : ""}
        <div class="profile-item"><div class="label">Timeline</div><div class="value">${esc(timeline)}</div></div>
        ${state.preferredTimeline && state.preferredTimeline !== timeline ? `<div class="profile-item"><div class="label">Preferred Timeline</div><div class="value">${esc(state.preferredTimeline)}</div></div>` : ""}
        <div class="profile-item"><div class="label">Session Goal</div><div class="value">${isExplore ? "Explore career options" : "Pursue a specific role"}</div></div>
        ${state.targetRole ? `<div class="profile-item"><div class="label">Target Role</div><div class="value">${esc(state.targetRole)}</div></div>` : ""}
        ${state.previousTargetRole && state.previousTargetRole !== state.targetRole ? `<div class="profile-item"><div class="label">Previously Considered</div><div class="value">${esc(state.previousTargetRole)}</div></div>` : ""}
        ${(state.comparedRoles ?? []).length > 0 ? `<div class="profile-item"><div class="label">Roles Compared</div><div class="value">${esc(state.comparedRoles.join(" vs "))}</div></div>` : ""}
      </div>
    </div>
  </div>

${renderSection2(state, isExplore, directions, candidateSkills, skills, techSkills, softSkills)}

${renderSection3(state, isExplore, skills, techSkills, softSkills, timeline, candidateSkills)}

${renderSection4(state, skills, techSkills, softSkills, timeline)}

${renderLearningEvidenceSection(state)}

${renderSection5(state, isExplore, directions)}

${renderPriorPlanAppendixHtml(state)}

  </div>

  <div class="footer">
    <p>Generated by <strong>Career Guidance Assistant</strong> | Data sourced from O*NET, BLS, and USAJOBS</p>
    <p>This report is for informational purposes only. Career outcomes depend on many factors. Consider consulting with a professional career advisor.</p>
  </div>

</body>
</html>`;

  writeFileSync(outputPath, html, "utf-8");
  return outputPath;
}

// ==========================================
// Section 2: Recommended Path / Directions
// ==========================================

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
    const topDirections = directions.slice(0, 3);
    const blended = blendSkillsAcrossRoles(candidateSkills, 5);
    return `
    <div class="section sec-path">
      <div class="section-header"><div class="icon">&#127919;</div> Recommended Career Directions</div>
      <div class="section-body">
        <p style="margin-bottom: 16px; color: #4a5568;">Based on your background and interests, the following career directions may be a strong fit:</p>
        ${topDirections.map((d, i) => `
        <div class="direction-card">
          <div class="direction-num">${i + 1}</div>
          <div class="direction-title">${esc(d.direction_title)}</div>
          <div class="direction-rationale">${esc(d.rationale)}</div>
        </div>`).join("")}
        ${blended.length > 0 ? `
        <h3 style="font-size: 15px; margin: 20px 0 10px; color: #2d3748;">Key Skills Across These Paths</h3>
        <p style="font-size: 13px; color: #718096; margin-bottom: 12px;">These skills appear frequently across your recommended directions:</p>
        <div class="action-grid">
          ${blended.map(s => `
          <div class="action-item">
            <div class="action-bullet" style="background: ${s.skill_type === "technical" ? "#2980b9" : "#8e44ad"};"></div>
            <div>
              <div style="font-weight: 600; font-size: 13px;">${esc(s.skill_name)} <span class="cat-pill ${s.skill_type === "technical" ? "cat-tech" : "cat-soft"}">${s.skill_type}</span></div>
              <div style="font-size: 12px; color: #718096;">Required: ${esc(s.required_proficiency || "Varies")}</div>
            </div>
          </div>`).join("")}
        </div>` : ""}
      </div>
    </div>`;
  }

  if (state.targetRole && skills.length > 0) {
    const topTech = techSkills.slice(0, 5);
    const topSoft = softSkills.slice(0, 5);
    return `
    <div class="section sec-path">
      <div class="section-header"><div class="icon">&#127919;</div> Recommended Career Path</div>
      <div class="section-body">
        <p style="font-size: 18px; font-weight: 700; color: #1a1a2e; margin-bottom: 8px;">${esc(state.targetRole)}</p>
        ${state.recommendedPath ? `<p style="color: #4a5568; margin-bottom: 20px;">${esc(state.recommendedPath)}</p>` : ""}
        <div class="two-col">
          ${topTech.length > 0 ? `
          <div class="skill-cat-card">
            <div class="skill-cat-header tech-header">
              <span>Technical Skills</span>
              <span class="cat-pill cat-tech">${topTech.length}</span>
            </div>
            <div class="skill-cat-body">
              <table class="skills-table">
                <thead><tr><th>Skill</th><th>Required</th><th>Your Level</th></tr></thead>
                <tbody>
                  ${topTech.map(s => `
                  <tr>
                    <td style="font-weight: 500;">${esc(s.skill_name)}</td>
                    <td>${esc(s.required_proficiency || "-")}</td>
                    <td>${fmtRatingBadge(s.user_rating)}</td>
                  </tr>`).join("")}
                </tbody>
              </table>
            </div>
          </div>` : ""}
          ${topSoft.length > 0 ? `
          <div class="skill-cat-card">
            <div class="skill-cat-header soft-header">
              <span>Soft Skills</span>
              <span class="cat-pill cat-soft">${topSoft.length}</span>
            </div>
            <div class="skill-cat-body">
              <table class="skills-table">
                <thead><tr><th>Skill</th><th>Required</th><th>Your Level</th></tr></thead>
                <tbody>
                  ${topSoft.map(s => `
                  <tr>
                    <td style="font-weight: 500;">${esc(s.skill_name)}</td>
                    <td>${esc(s.required_proficiency || "-")}</td>
                    <td>${fmtRatingBadge(s.user_rating)}</td>
                  </tr>`).join("")}
                </tbody>
              </table>
            </div>
          </div>` : ""}
        </div>
      </div>
    </div>`;
  }

  return `
    <div class="section sec-path">
      <div class="section-header"><div class="icon">&#127919;</div> Recommended Career Path</div>
      <div class="section-body">
        <p>${esc(state.recommendedPath ?? "Complete a full career coaching session to receive personalized career path recommendations.")}</p>
      </div>
    </div>`;
}

// ==========================================
// Section 3: Skill Gap Analysis
// ==========================================

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
    const techGaps = techSkills.filter(s => s.gap_category === "absent" || s.gap_category === "underdeveloped");
    const softGaps = softSkills.filter(s => s.gap_category === "absent" || s.gap_category === "underdeveloped");

    return `
    <div class="section sec-skills">
      <div class="section-header"><div class="icon">&#128202;</div> Skill Gap Analysis</div>
      <div class="section-body">
        ${techSkills.length > 0 ? `
        <h3 style="font-size: 15px; color: #2471a3; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
          <span class="cat-pill cat-tech">TECHNICAL</span> Skills Assessment
        </h3>
        <table class="skills-table">
          <thead><tr><th>Skill</th><th>Required</th><th>Your Level</th><th>Status</th><th>Suggested Action</th></tr></thead>
          <tbody>
            ${techSkills.map(s => `
            <tr>
              <td style="font-weight: 500;">${esc(s.skill_name)}</td>
              <td>${esc(s.required_proficiency || "-")}</td>
              <td>${fmtRatingBadge(s.user_rating)}</td>
              <td>${fmtGapBadge(s.gap_category)}</td>
              <td style="font-size: 12px; color: #4a5568;">${esc(suggestTechAction(s))}</td>
            </tr>`).join("")}
          </tbody>
        </table>
        ${techGaps.length > 0 ? `
        <div class="note-box" style="margin-top: 12px;">
          <strong>Learning resources:</strong> For technical gaps, you might explore free resources on YouTube and freeCodeCamp first, then consider structured courses on Coursera or edX within your ${esc(timeline)} timeline.
        </div>` : ""}
        ` : ""}

        ${softSkills.length > 0 ? `
        <h3 style="font-size: 15px; color: #7d3c98; margin: 24px 0 12px; display: flex; align-items: center; gap: 8px;">
          <span class="cat-pill cat-soft">SOFT</span> Skills Assessment
        </h3>
        <table class="skills-table">
          <thead><tr><th>Skill</th><th>Required</th><th>Your Level</th><th>Status</th><th>Suggested Action</th></tr></thead>
          <tbody>
            ${softSkills.map(s => `
            <tr>
              <td style="font-weight: 500;">${esc(s.skill_name)}</td>
              <td>${esc(s.required_proficiency || "-")}</td>
              <td>${fmtRatingBadge(s.user_rating)}</td>
              <td>${fmtGapBadge(s.gap_category)}</td>
              <td style="font-size: 12px; color: #4a5568;">${esc(suggestSoftAction(s))}</td>
            </tr>`).join("")}
          </tbody>
        </table>
        <div class="note-box">
          <strong>A note on soft skills:</strong> Many interpersonal and leadership skills develop most effectively through hands-on experience, mentoring, and real-world practice. Consider seeking out projects, volunteer roles, or workplace opportunities that let you practice these skills regularly.
        </div>` : ""}
      </div>
    </div>`;
  }

  // Explore track or empty skills — blended skills already shown in Section 2, skip here
  return `
    <div class="section sec-skills">
      <div class="section-header"><div class="icon">&#128202;</div> Skill Gap Analysis</div>
      <div class="section-body">
        <p>${esc(
          !state.targetRole
            ? "To get a personalized skill gap analysis with ratings and course recommendations, start a focused session for one of the recommended career directions above."
            : state.skillsAssessmentStatus === "complete"
              ? `Skills assessment for ${state.targetRole} is marked complete, but no skill records were retrieved for this report. Open the session in the app to view full results.`
              : "Skills assessment was not completed. Continue your session or start a new one for a full gap analysis."
        )}</p>
      </div>
    </div>`;
}

// ==========================================
// Section 4: Development Timeline (GBH IDP style)
// ==========================================

function renderSection4(
  state: AgentStateType,
  skills: SkillAssessment[],
  techSkills: SkillAssessment[],
  softSkills: SkillAssessment[],
  timeline: string,
): string {
  const agenda = state.skillDevelopmentAgenda ?? [];

  // Build timeline steps from agenda or generate defaults
  const steps: { label: string; content: string }[] = [];

  if (agenda.length > 0) {
    agenda.forEach((item, i) => {
      steps.push({ label: `Priority ${i + 1}`, content: item });
    });
  } else if (skills.length > 0) {
    const gaps = skills.filter(s => s.gap_category === "absent" || s.gap_category === "underdeveloped");
    if (gaps.length > 0) {
      steps.push({ label: "Assess", content: "Complete self-assessment of all required skills for your target role" });
      steps.push({ label: "Foundation", content: `Build foundational knowledge in ${gaps.slice(0, 2).map(s => s.skill_name).join(" and ")}` });
      steps.push({ label: "Practice", content: "Apply skills through projects, exercises, or real-world tasks" });
      steps.push({ label: "Review", content: "Revisit progress and adjust your development plan as needed" });
    }
  }

  return `
    <div class="section sec-timeline">
      <div class="section-header"><div class="icon">&#128197;</div> Development Timeline</div>
      <div class="section-body">
        <p style="margin-bottom: 20px;"><strong>Estimated timeline:</strong> ${esc(timeline)}</p>
        ${steps.length > 0 ? `
        <div class="idp-steps">
          ${steps.map((step, i) => {
            const n = (i % 5) + 1;
            const icons = ["&#128203;", "&#128198;", "&#128101;", "&#128260;", "&#127919;"];
            return `
          <div class="idp-step idp-s${n}">
            <div class="idp-icon-circle">${icons[n - 1]}</div>
            <div class="idp-step-wrap">
              <div class="idp-step-bar">Step ${String(i + 1).padStart(2, "0")}: ${esc(step.label)}</div>
              <div class="idp-step-body">${esc(step.content)}</div>
            </div>
          </div>`;
          }).join("")}
        </div>` : `
        <p style="color: #718096;">Complete a full career coaching session to receive a personalized development timeline.</p>`}

        ${skills.length > 0 ? (() => {
          const assessedCount = skills.filter(s => s.user_rating !== null).length;
          const assessedPct = skills.length > 0 ? Math.round((assessedCount / skills.length) * 100) : 0;
          const techStrength = techSkills.length > 0 ? Math.round((techSkills.filter(s => s.gap_category === "strong").length / techSkills.length) * 100) : 0;
          const softStrength = softSkills.length > 0 ? Math.round((softSkills.filter(s => s.gap_category === "strong").length / softSkills.length) * 100) : 0;
          const techProg = computeProximityStats(skills).techProgressPct;
          const softProg = computeProximityStats(skills).softProgressPct;
          const lowStrengthNote = assessedPct === 100 && (techStrength + softStrength) < 25
            ? `<p style="font-size: 12px; color: #4a5568; margin-top: 10px;">You've assessed every skill — the strength number climbs as you move toward advanced/expert, which is exactly what your development plan is designed to get you to.</p>`
            : "";
          return `
        <h3 style="font-size: 14px; margin: 24px 0 12px; color: #2d3748;">Overall Readiness</h3>
        <div style="margin-bottom: 14px;">
          <div style="font-size: 13px; font-weight: 600; color: #c94c4c; margin-bottom: 4px;">Assessment Completion (${assessedCount}/${skills.length} rated)</div>
          <div class="progress-bar-wrap"><div class="progress-bar-fill fill-strong" style="width: ${assessedPct}%;"></div></div>
        </div>
        <div class="two-col">
          <div>
            <div style="font-size: 13px; font-weight: 600; color: #2471a3; margin-bottom: 4px;">Technical — progress toward required (${techProg}%)</div>
            <div class="progress-bar-wrap"><div class="progress-bar-fill fill-tech" style="width: ${techProg}%;"></div></div>
            <div style="font-size: 11px; color: #718096; margin-top: 3px;">Currently at advanced/expert: ${techStrength}%</div>
          </div>
          <div>
            <div style="font-size: 13px; font-weight: 600; color: #7d3c98; margin-bottom: 4px;">Soft — progress toward required (${softProg}%)</div>
            <div class="progress-bar-wrap"><div class="progress-bar-fill fill-soft" style="width: ${softProg}%;"></div></div>
            <div style="font-size: 11px; color: #718096; margin-top: 3px;">Currently at advanced/expert: ${softStrength}%</div>
          </div>
        </div>
        ${lowStrengthNote}
        <p style="font-size: 11px; color: #718096; margin-top: 8px; font-style: italic;">Progress averages how close your current level is to the required level per skill. Strength counts only the skills already at advanced/expert.</p>`;
        })() : ""}
      </div>
    </div>`;
}

// ==========================================
// Learning resources + evidence log (plan deliverables)
// ==========================================

function renderLearningEvidenceSection(state: AgentStateType): string {
  const lr = state.learningResources ?? [];
  const kept = state.evidenceKept ?? [];
  const disc = state.evidenceDiscarded ?? [];
  if (lr.length === 0 && kept.length === 0 && disc.length === 0) {
    return "";
  }

  const resourcesBlock =
    lr.length > 0
      ? `
        <h3 style="font-size: 14px; margin-bottom: 12px; color: #2874a6;">Suggested learning resources</h3>
        <ul class="checklist">
          ${lr.map((r) => `
          <li>
            <div class="check-circle"></div>
            <div class="check-text"><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>${r.note ? ` <span style="color:#718096;font-size:13px;">(${esc(r.note)})</span>` : ""}</div>
          </li>`).join("")}
        </ul>`
      : "";

  const keptBlock =
    kept.length > 0
      ? `
        <h3 style="font-size: 14px; margin: 20px 0 10px; color: #27ae60;">Evidence retained</h3>
        <ul class="checklist">
          ${kept.map((e) => `
          <li>
            <div class="check-circle done"></div>
            <div class="check-text"><strong>${esc(e.source)}</strong>: ${esc(e.detail)} <em style="color:#718096;">(${esc(e.reason)})</em></div>
          </li>`).join("")}
        </ul>`
      : "";

  const discBlock =
    disc.length > 0
      ? `
        <h3 style="font-size: 14px; margin: 20px 0 10px; color: #c0392b;">Evidence set aside</h3>
        <ul class="checklist">
          ${disc.map((e) => `
          <li>
            <div class="check-circle"></div>
            <div class="check-text"><strong>${esc(e.source)}</strong>: ${esc(e.detail)} <em style="color:#718096;">(${esc(e.reason)})</em></div>
          </li>`).join("")}
        </ul>`
      : "";

  return `
    <div class="section sec-evidence">
      <div class="section-header"><div class="icon">&#128196;</div> Resources &amp; evidence log</div>
      <div class="section-body">
        ${resourcesBlock}
        ${keptBlock}
        ${discBlock}
      </div>
    </div>`;
}

// ==========================================
// Section 5: Suggested Next Steps (Checklist style)
// ==========================================

function renderSection5(
  state: AgentStateType,
  isExplore: boolean,
  directions: AgentStateType["candidateDirections"],
): string {
  let items: string[] = [];

  if (state.immediateNextSteps.length > 0) {
    items = state.immediateNextSteps.map(softenStep);
  } else if (isExplore && directions.length > 0) {
    items = [
      `You might consider researching job postings for ${directions[0].direction_title} to understand current market expectations`,
      "It could be helpful to connect with professionals in these fields for informational conversations",
      "You may find it valuable to start a focused session for your top-choice role to get a detailed skill gap analysis",
    ];
  }

  const byDay: string[][] = [[], [], [], [], []];
  items.forEach((item, i) => {
    byDay[i % 5]!.push(item);
  });

  return `
    <div class="section sec-steps">
      <div class="section-header"><div class="icon">&#9989;</div> Suggested next steps (first-week view)</div>
      <div class="section-body">
        ${items.length > 0 ? `
        <p style="margin-bottom: 16px; color: #5c5c5c; font-size: 14px;">Tasks are grouped across five focus days, similar to a new-hire checklist. Check them off as you go.</p>
        <div class="week-plan-grid">
          ${byDay.map((dayItems, d) => {
            const alt = d % 2 === 0 ? "day-a" : "day-b";
            return `
          <div class="day-card ${alt}">
            <div class="day-header">Day ${d + 1}</div>
            <ul class="day-list">
              ${dayItems.length > 0
                ? dayItems.map(item => `
              <li>
                <div class="check-circle"></div>
                <div class="check-text">${esc(item)}</div>
              </li>`).join("")
                : `<li class="day-placeholder">Buffer day: revisit priorities or catch up on earlier steps.</li>`}
            </ul>
          </div>`;
          }).join("")}
        </div>` : `
        <p style="color: #718096;">Complete a full career coaching session to receive personalized next steps.</p>`}
      </div>
    </div>`;
}

// ==========================================
// Helpers
// ==========================================

function suggestTechAction(skill: SkillAssessment): string {
  if (skill.gap_category === "absent") return "Consider starting with free tutorials and introductory courses";
  if (skill.gap_category === "underdeveloped") return "Consider intermediate-level practice projects or structured courses";
  return "Continue building on this strength";
}

function suggestSoftAction(skill: SkillAssessment): string {
  if (skill.gap_category === "absent") return "Seek opportunities to practice in team settings or projects";
  if (skill.gap_category === "underdeveloped") return "Look for mentoring or leadership opportunities to develop further";
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

/**
 * Change 4 (BR-9): render prior plan as an appendix in the HTML report.
 * Only fires when state.priorPlan is non-null (i.e. user pivoted target
 * roles mid-session).
 */
function renderPriorPlanAppendixHtml(state: AgentStateType): string {
  const pp = state.priorPlan;
  if (!pp) return "";
  const generated = new Date(pp.generated_at).toLocaleDateString();
  const agenda = (pp.skill_development_agenda ?? []).map(
    (s) => `<li>${esc(s)}</li>`,
  ).join("");
  const steps = (pp.immediate_next_steps ?? []).map(
    (s) => `<li>${esc(s)}</li>`,
  ).join("");
  return `
    <div class="section sec-profile">
      <div class="section-header"><div class="icon">&#128196;</div> Appendix A: Prior plan (${esc(pp.target_role)}, ${esc(generated)})</div>
      <div class="section-body">
        <p style="color: #4a5568; margin-bottom: 12px;">You previously explored <strong>${esc(pp.target_role)}</strong> in this session. Your original plan is kept on file below for reference.</p>
        ${pp.recommended_path ? `<h3 style="font-size: 14px; color: #2d3748; margin: 14px 0 6px;">Recommended path</h3><p style="font-size: 13px; color: #4a5568;">${esc(pp.recommended_path)}</p>` : ""}
        ${agenda ? `<h3 style="font-size: 14px; color: #2d3748; margin: 14px 0 6px;">Skill development agenda</h3><ul style="font-size: 13px; color: #4a5568; padding-left: 20px;">${agenda}</ul>` : ""}
        ${steps ? `<h3 style="font-size: 14px; color: #2d3748; margin: 14px 0 6px;">Immediate next steps</h3><ul style="font-size: 13px; color: #4a5568; padding-left: 20px;">${steps}</ul>` : ""}
        ${pp.timeline ? `<p style="font-size: 12px; color: #718096; font-style: italic; margin-top: 12px;">Prior timeline: ${esc(pp.timeline)}</p>` : ""}
      </div>
    </div>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtEdu(level: string | null): string {
  const m: Record<string, string> = { high_school: "High School Diploma", associate: "Associate's Degree", bachelor: "Bachelor's Degree", master: "Master's Degree", doctoral: "Doctoral Degree", other: "Other" };
  return level ? m[level] ?? level : "Not provided";
}

function fmtRatingBadge(r: string | null): string {
  const m: Record<string, [string, string]> = {
    beginner: ["Beginner", "#e74c3c"],
    intermediate: ["Intermediate", "#f39c12"],
    advanced: ["Advanced", "#2ecc71"],
    expert: ["Expert", "#27ae60"],
    // backward compat for old sessions:
    not_yet_familiar: ["New", "#e74c3c"],
    working_knowledge: ["Intermediate", "#f39c12"],
    strong_proficiency: ["Strong", "#27ae60"],
  };
  if (!r) return `<span style="color: #a0aec0;">-</span>`;
  const [label, color] = m[r] ?? [r, "#718096"];
  return `<span style="color: ${color}; font-weight: 600; font-size: 12px;">${label}</span>`;
}

function fmtGapBadge(g: string | null): string {
  const m: Record<string, [string, string, string]> = {
    absent: ["Needs Development", "#e74c3c", "#fdf2f2"],
    underdeveloped: ["Needs Growth", "#f39c12", "#fffbeb"],
    strong: ["On Track", "#27ae60", "#f0fdf4"],
  };
  if (!g) return `<span style="color: #a0aec0;">-</span>`;
  const [label, color, bg] = m[g] ?? [g, "#718096", "#f7fafc"];
  return `<span style="color: ${color}; background: ${bg}; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600;">${label}</span>`;
}
