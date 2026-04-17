import PDFDocument from "pdfkit";
import { createWriteStream } from "fs";
import { join } from "path";
import type { AgentStateType, SkillAssessment } from "../state.js";
import { config } from "../config.js";
import { blendSkillsAcrossRoles, categorizeSkillType } from "../utils/rag.js";
import { getDisplayRole, computeReadinessStats } from "./report-helpers.js";

export async function generatePDFReport(state: AgentStateType): Promise<string> {
  const outputPath = join(config.paths.root, "exports", `career-plan-${state.sessionId}.pdf`);

  // Ensure exports directory exists
  const { mkdirSync } = await import("fs");
  mkdirSync(join(config.paths.root, "exports"), { recursive: true });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const stream = createWriteStream(outputPath);
    doc.pipe(stream);

    doc.save();
    doc.rect(0, 0, doc.page.width, 6).fill("#2a9d8f");
    doc.restore();

    const hasAssessedRole = Boolean(state.targetRole) && (state.skills ?? []).length > 0;
    const isExplore = state.sessionGoal === "explore_options" && !hasAssessedRole;
    const directions = dedupeDirections(state.candidateDirections ?? []);
    const candidateSkills = (state as any).candidateSkills ?? {};
    const skills = (state.skills ?? []).map((s: SkillAssessment) => ({
      ...s,
      skill_type: s.skill_type ?? categorizeSkillType(s.skill_name),
    }));
    const techSkills = skills.filter((s: SkillAssessment) => s.skill_type === "technical");
    const softSkills = skills.filter((s: SkillAssessment) => s.skill_type === "soft");
    const timeline = state.timeline ?? "to be determined";
    const displayRole = getDisplayRole(state);
    const headerStats = computeReadinessStats(skills);
    const techStrengthPct = techSkills.length > 0
      ? Math.round((techSkills.filter(s => s.gap_category === "strong").length / techSkills.length) * 100)
      : 0;
    const softStrengthPct = softSkills.length > 0
      ? Math.round((softSkills.filter(s => s.gap_category === "strong").length / softSkills.length) * 100)
      : 0;

    // --- Title ---
    doc.fillColor("#c94c4c").fontSize(22).font("Helvetica-Bold").text("Career Development Plan", { align: "center" });
    doc.fillColor("#333333");
    doc.moveDown(0.4);
    doc.fontSize(10).font("Helvetica").fillColor("#666666")
      .text(`Personalized guidance report | ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, { align: "center" });
    doc.fillColor("#000000");
    doc.moveDown(0.6);

    // Header badges (parity with HTML hero): Goal • Role • Location
    const badges: { label: string; fill: string; border: string; fg: string }[] = [
      { label: isExplore ? "Exploring Options" : "Specific Role", fill: "#fff3cd", border: "#e8b931", fg: "#8a6d00" },
    ];
    if (displayRole) badges.push({ label: displayRole, fill: "#e8f8ef", border: "#52c97f", fg: "#1e6b3d" });
    if (state.location) badges.push({ label: state.location, fill: "#e8f4fc", border: "#7eb8da", fg: "#1a5270" });
    renderHeaderBadges(doc, badges);

    // Header readiness chips (only when skills assessed): Assessed • Tech • Soft
    if (skills.length > 0) {
      renderHeaderStatChips(doc, [
        { pct: headerStats.assessmentPct, label: "Assessed", color: "#c94c4c" },
        { pct: techStrengthPct, label: "Tech Strength", color: "#2874a6" },
        { pct: softStrengthPct, label: "Soft Strength", color: "#7d3c98" },
      ]);
    }

    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke("#e8c4cc");
    doc.moveDown(0.8);

    // --- Section 1: Profile ---
    sectionBanner(doc, "1. Your career snapshot", "orange");
    addField(doc, "Current Role", state.jobTitle ?? "Not provided");
    addField(doc, "Industry", state.industry ?? "Not provided");
    addField(doc, "Experience", state.yearsExperience !== null ? `${state.yearsExperience} years` : "Not provided");
    addField(doc, "Education", formatEducation(state.educationLevel));
    if (state.location) addField(doc, "Location", state.location);
    addField(doc, "Timeline", timeline);
    if (state.preferredTimeline && state.preferredTimeline !== timeline) {
      addField(doc, "Preferred Timeline", state.preferredTimeline);
    }
    addField(doc, "Session Goal", state.sessionGoal === "explore_options" ? "Explore career options" : "Pursue a specific role");
    if (state.targetRole) {
      addField(doc, "Target Role", state.targetRole);
    }
    // Change 4: render previously-considered role when a pivot happened
    if (state.previousTargetRole && state.previousTargetRole !== state.targetRole) {
      addField(doc, "Previously Considered", state.previousTargetRole);
    }
    // Change 4: render active two-role comparison when present
    if ((state.comparedRoles ?? []).length > 0) {
      addField(doc, "Roles Compared", state.comparedRoles.join(" vs "));
    }
    doc.moveDown(0.5);

    // --- Section 2: Recommended Career Path ---
    renderSection2(doc, state, isExplore, directions, candidateSkills, skills, techSkills, softSkills);

    // --- Section 3: Skill Gap Analysis ---
    renderSection3(doc, state, isExplore, skills, techSkills, softSkills, timeline, candidateSkills);

    // --- Section 4: Development Timeline (GBH-style steps) ---
    sectionBanner(doc, "4. Development timeline", "purple");
    doc.fontSize(11).font("Helvetica").fillColor("#000000")
      .text(`Estimated timeline: ${timeline}`, { lineGap: 4 });

    const devSteps = buildDevelopmentSteps(state, skills);
    if (devSteps.length > 0) {
      doc.moveDown(0.3);
      for (let i = 0; i < devSteps.length; i++) {
        renderIdpStepPdf(doc, i, devSteps[i]!.label, devSteps[i]!.content);
      }
    } else {
      doc.moveDown(0.3);
      doc.fontSize(10).font("Helvetica").fillColor("#666666")
        .text("Complete a full career coaching session to receive a personalized development timeline.", { lineGap: 3 });
    }

    if (skills.length > 0) {
      doc.moveDown(0.3);
      doc.fontSize(11).font("Helvetica-Bold").fillColor("#333333").text("Overall readiness");
      doc.moveDown(0.2);
      // Change 5 P0 (Apr 14 2026): split assessment-completion vs current-strength.
      // Users expect to see 100% after rating every skill even if they're still learning.
      const stats = computeReadinessStats(skills);
      const techStrength = techSkills.length > 0 ? Math.round((techSkills.filter(s => s.gap_category === "strong").length / techSkills.length) * 100) : 0;
      const softStrength = softSkills.length > 0 ? Math.round((softSkills.filter(s => s.gap_category === "strong").length / softSkills.length) * 100) : 0;
      doc.fontSize(10).font("Helvetica").fillColor("#c94c4c").text(`Assessment completion: ${stats.assessmentPct}% (${stats.assessedSkills}/${stats.totalSkills} skills rated)`);
      doc.fillColor("#2874a6").text(`Technical skills — current strength: ${techStrength}%`);
      doc.fillColor("#7d3c98").text(`Soft skills — current strength: ${softStrength}%`);
      doc.fillColor("#666666").fontSize(9).font("Helvetica-Oblique")
        .text("Strength reflects skills you already rate as advanced/expert. Gaps are expected and are exactly what your development plan addresses.", { lineGap: 2 });
      doc.fillColor("#000000");
    }
    doc.moveDown(0.5);

    // --- Section 5: Suggested Next Steps (5-day view) ---
    sectionBanner(doc, "5. Suggested next steps (first-week view)", "coral");
    const nextItems: string[] =
      state.immediateNextSteps.length > 0
        ? state.immediateNextSteps.map(softenStep)
        : isExplore && directions.length > 0
          ? [
              `You might consider researching job postings for ${directions[0].direction_title} to understand current market expectations`,
              "It could be helpful to connect with professionals in these fields for informational conversations",
              "You may find it valuable to start a focused session for your top-choice role to get a detailed skill gap analysis",
            ]
          : [];

    if (nextItems.length > 0) {
      doc.fontSize(9).font("Helvetica").fillColor("#555555")
        .text("Tasks are grouped across five focus days (round-robin). Empty days are buffer time.", { lineGap: 2 });
      doc.fillColor("#000000");
      doc.moveDown(0.3);
      const byDay: string[][] = [[], [], [], [], []];
      nextItems.forEach((item, i) => {
        byDay[i % 5]!.push(item);
      });
      for (let d = 0; d < 5; d++) {
        checkPageBreak(doc);
        renderDayHeaderPdf(doc, d + 1, d % 2 === 0);
        const lines = byDay[d]!;
        if (lines.length === 0) {
          doc.fontSize(10).font("Helvetica-Oblique").fillColor("#888888")
            .text("Buffer day: revisit priorities or catch up on earlier steps.", { lineGap: 2 });
          doc.fillColor("#000000");
        } else {
          for (const line of lines) {
            doc.fontSize(10).font("Helvetica").fillColor("#000000").text(`    •  ${line}`, { lineGap: 3 });
          }
        }
        doc.moveDown(0.4);
      }
    } else {
      doc.fontSize(11).font("Helvetica").fillColor("#000000")
        .text("Complete a full career coaching session to receive personalized recommendations.", { lineGap: 4 });
    }
    doc.moveDown(0.5);

    renderLearningEvidencePdf(doc, state);

    // Change 4: prior plan appendix when a same-session pivot happened
    renderPriorPlanAppendixPdf(doc, state);

    // --- Footer ---
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke("#cccccc");
    doc.moveDown(0.5);
    doc.fontSize(8).font("Helvetica").fillColor("#999999")
      .text("Generated by Career Guidance Assistant. This report is for informational purposes only.", { align: "center" });
    doc.text("Career outcomes depend on many factors. Consider consulting with a professional career advisor for personalized guidance.", { align: "center" });

    doc.end();

    stream.on("finish", () => resolve(outputPath));
    stream.on("error", reject);
  });
}

/**
 * Change 4 (BR-9): render any prior plan as an appendix so users who pivoted
 * target roles mid-session still have their previous plan on file. Only
 * fires when `state.priorPlan` is non-null.
 */
function renderPriorPlanAppendixPdf(doc: PDFKit.PDFDocument, state: AgentStateType): void {
  const pp = state.priorPlan;
  if (!pp) return;
  const generated = new Date(pp.generated_at).toLocaleDateString();

  checkPageBreak(doc);
  doc.moveDown(0.8);
  sectionBanner(doc, `Appendix A: Prior plan (${pp.target_role}, ${generated})`, "blue");
  doc.fontSize(10).font("Helvetica").fillColor("#555555")
    .text(`You previously explored ${pp.target_role} in this session. Your original plan is kept on file below for reference.`, { lineGap: 3 });
  doc.fillColor("#000000");
  doc.moveDown(0.4);

  if (pp.recommended_path) {
    doc.fontSize(11).font("Helvetica-Bold").fillColor("#333333")
      .text("Recommended path");
    doc.moveDown(0.2);
    doc.fontSize(10).font("Helvetica").fillColor("#000000")
      .text(pp.recommended_path, { lineGap: 3 });
    doc.moveDown(0.3);
  }

  if ((pp.skill_development_agenda ?? []).length > 0) {
    checkPageBreak(doc);
    doc.fontSize(11).font("Helvetica-Bold").fillColor("#333333")
      .text("Skill development agenda");
    doc.moveDown(0.2);
    doc.fontSize(10).font("Helvetica").fillColor("#000000");
    for (const item of pp.skill_development_agenda) {
      doc.text(`  • ${item}`, { lineGap: 2 });
    }
    doc.moveDown(0.3);
  }

  if ((pp.immediate_next_steps ?? []).length > 0) {
    checkPageBreak(doc);
    doc.fontSize(11).font("Helvetica-Bold").fillColor("#333333")
      .text("Immediate next steps");
    doc.moveDown(0.2);
    doc.fontSize(10).font("Helvetica").fillColor("#000000");
    for (const step of pp.immediate_next_steps) {
      doc.text(`  • ${step}`, { lineGap: 2 });
    }
    doc.moveDown(0.3);
  }

  if (pp.timeline) {
    doc.fontSize(10).font("Helvetica-Oblique").fillColor("#666666")
      .text(`Prior timeline: ${pp.timeline}`, { lineGap: 2 });
    doc.fillColor("#000000");
  }
}

function renderLearningEvidencePdf(doc: PDFKit.PDFDocument, state: AgentStateType): void {
  const lr = state.learningResources ?? [];
  const kept = state.evidenceKept ?? [];
  const disc = state.evidenceDiscarded ?? [];
  if (lr.length === 0 && kept.length === 0 && disc.length === 0) return;

  checkPageBreak(doc);
  sectionBanner(doc, "6. Resources & evidence log", "blue");
  if (lr.length > 0) {
    doc.fontSize(11).font("Helvetica-Bold").fillColor("#2874a6").text("Suggested learning resources");
    doc.moveDown(0.2);
    doc.fontSize(10).font("Helvetica").fillColor("#000000");
    for (const r of lr) {
      doc.text(`  • ${r.title}: ${r.url}${r.note ? ` (${r.note})` : ""}`, { lineGap: 2 });
    }
    doc.moveDown(0.3);
  }
  if (kept.length > 0) {
    doc.fontSize(11).font("Helvetica-Bold").fillColor("#27ae60").text("Evidence retained");
    doc.moveDown(0.2);
    doc.fontSize(10).font("Helvetica").fillColor("#000000");
    for (const e of kept) {
      doc.text(`  + [${e.source}] ${e.detail}. Reason: ${e.reason}`, { lineGap: 2 });
    }
    doc.moveDown(0.3);
  }
  if (disc.length > 0) {
    doc.fontSize(11).font("Helvetica-Bold").fillColor("#c0392b").text("Evidence set aside");
    doc.moveDown(0.2);
    doc.fontSize(10).font("Helvetica").fillColor("#000000");
    for (const e of disc) {
      doc.text(`  - [${e.source}] ${e.detail}. Reason: ${e.reason}`, { lineGap: 2 });
    }
    doc.moveDown(0.3);
  }
}

function dedupeDirections<T extends { direction_title?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const key = (it.direction_title ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

// --- Header badges + stat chips (parity with HTML hero) ---

function renderHeaderBadges(
  doc: PDFKit.PDFDocument,
  badges: { label: string; fill: string; border: string; fg: string }[],
): void {
  if (badges.length === 0) return;
  doc.fontSize(9).font("Helvetica-Bold");
  const y = doc.y;
  const gap = 8;
  const padX = 10;
  const h = 20;
  const widths = badges.map(b => doc.widthOfString(b.label) + padX * 2);
  const totalW = widths.reduce((a, b) => a + b, 0) + gap * (badges.length - 1);
  let x = doc.page.width / 2 - totalW / 2;
  for (let i = 0; i < badges.length; i++) {
    const b = badges[i];
    const w = widths[i];
    doc.save();
    doc.roundedRect(x, y, w, h, 10).fillAndStroke(b.fill, b.border);
    doc.restore();
    doc.fillColor(b.fg).text(b.label, x, y + 5, { width: w, align: "center" });
    x += w + gap;
  }
  doc.y = y + h + 10;
  doc.fillColor("#000000");
}

function renderHeaderStatChips(
  doc: PDFKit.PDFDocument,
  chips: { pct: number; label: string; color: string }[],
): void {
  if (chips.length === 0) return;
  const y = doc.y;
  const gap = 10;
  const cardW = 120;
  const cardH = 58;
  const totalW = cardW * chips.length + gap * (chips.length - 1);
  let x = doc.page.width / 2 - totalW / 2;
  for (const chip of chips) {
    doc.save();
    doc.roundedRect(x, y, cardW, cardH, 12).fillAndStroke("#ffffff", "#ead5dc");
    doc.restore();
    doc.fontSize(22).font("Helvetica-Bold").fillColor(chip.color)
      .text(`${chip.pct}%`, x, y + 8, { width: cardW, align: "center" });
    doc.fontSize(8).font("Helvetica").fillColor("#888888")
      .text(chip.label.toUpperCase(), x, y + 38, { width: cardW, align: "center", characterSpacing: 0.5 });
    x += cardW + gap;
  }
  doc.y = y + cardH + 12;
  doc.fillColor("#000000");
}

// --- Section Renderers ---

function renderSection2(
  doc: PDFKit.PDFDocument,
  state: AgentStateType,
  isExplore: boolean,
  directions: AgentStateType["candidateDirections"],
  candidateSkills: Record<string, SkillAssessment[]>,
  skills: SkillAssessment[],
  techSkills: SkillAssessment[],
  softSkills: SkillAssessment[],
): void {
  if (isExplore && directions.length > 0) {
    // Explore track: ranked directions (capped at 3) + blended skills
    sectionBanner(doc, "2. Recommended career directions", "green");
    doc.fontSize(11).font("Helvetica").fillColor("#000000")
      .text("Based on your background and interests, the following career directions may be a strong fit:", { lineGap: 4 });
    doc.moveDown(0.3);

    const topDirections = directions.slice(0, 3);
    for (let i = 0; i < topDirections.length; i++) {
      checkPageBreak(doc);
      doc.fontSize(12).font("Helvetica-Bold").fillColor("#1a1a2e")
        .text(`${i + 1}. ${topDirections[i].direction_title}`);
      doc.fontSize(10).font("Helvetica").fillColor("#555555")
        .text(topDirections[i].rationale, { lineGap: 2 });
      doc.moveDown(0.3);
    }

    const blended = blendSkillsAcrossRoles(candidateSkills, 5);
    if (blended.length > 0) {
      doc.moveDown(0.3);
      doc.fontSize(12).font("Helvetica-Bold").fillColor("#333333")
        .text("Key Skills Across These Paths");
      doc.fontSize(10).font("Helvetica").fillColor("#666666")
        .text("These skills appear frequently across your recommended directions and could give you leverage in pursuing any of them:", { lineGap: 2 });
      doc.moveDown(0.3);
      renderSkillsSubtable(doc, blended, ["Skill", "Type", "Typical Level"], (s) => [
        s.skill_name,
        s.skill_type,
        s.required_proficiency || "-",
      ]);
    }
    doc.moveDown(0.5);
    return;
  }

  if (state.targetRole && skills.length > 0) {
    // Specific role track: target role + tech/soft skill tables
    // Change 5 P0 (Apr 14 2026): use getDisplayRole so title + badge agree.
    sectionBanner(doc, "2. Recommended career path", "green");
    addField(doc, "Target Role", getDisplayRole(state) ?? state.targetRole);
    if (state.recommendedPath) {
      doc.fontSize(11).font("Helvetica").fillColor("#000000")
        .text(state.recommendedPath, { lineGap: 4 });
    }
    doc.moveDown(0.3);

    const topTech = techSkills.slice(0, 5);
    const topSoft = softSkills.slice(0, 5);

    if (topTech.length > 0) {
      doc.fontSize(12).font("Helvetica-Bold").fillColor("#333333")
        .text(`Top Technical Skills for ${state.targetRole}`);
      doc.moveDown(0.2);
      renderSkillsSubtable(doc, topTech, ["Skill", "Required Level", "Your Level"], (s) => [
        s.skill_name,
        s.required_proficiency || "-",
        formatRating(s.user_rating),
      ]);
      doc.moveDown(0.3);
    }

    if (topSoft.length > 0) {
      checkPageBreak(doc);
      doc.fontSize(12).font("Helvetica-Bold").fillColor("#333333")
        .text(`Top Soft Skills for ${state.targetRole}`);
      doc.moveDown(0.2);
      renderSkillsSubtable(doc, topSoft, ["Skill", "Required Level", "Your Level"], (s) => [
        s.skill_name,
        s.required_proficiency || "-",
        formatRating(s.user_rating),
      ]);
    }
    doc.moveDown(0.5);
    return;
  }

  // Fallback
  sectionBanner(doc, "2. Recommended career path", "green");
  if (state.recommendedPath) {
    doc.fontSize(11).font("Helvetica").fillColor("#000000")
      .text(state.recommendedPath, { lineGap: 4 });
  } else {
    doc.fontSize(11).font("Helvetica").fillColor("#000000")
      .text("A recommended career path could not be generated for this session. Complete a full career coaching session to receive personalized recommendations.", { lineGap: 4 });
  }
  doc.moveDown(0.5);
}

function renderSection3(
  doc: PDFKit.PDFDocument,
  state: AgentStateType,
  isExplore: boolean,
  skills: SkillAssessment[],
  techSkills: SkillAssessment[],
  softSkills: SkillAssessment[],
  timeline: string,
  candidateSkills: Record<string, SkillAssessment[]>,
): void {
  if (!isExplore && skills.length > 0) {
    // Specific role: tech/soft gap tables with actionables
    sectionBanner(doc, "3. Skill gap analysis", "blue");

    if (techSkills.length > 0) {
      doc.fontSize(12).font("Helvetica-Bold").fillColor("#333333").text("Technical Skills");
      doc.moveDown(0.2);
      renderGapTable(doc, techSkills, timeline, "tech");

      const techGaps = techSkills.filter(s => s.gap_category === "absent" || s.gap_category === "underdeveloped");
      if (techGaps.length > 0) {
        doc.moveDown(0.3);
        doc.fontSize(9).font("Helvetica-Oblique").fillColor("#555555")
          .text(`For technical skill gaps, you might explore free resources on YouTube and freeCodeCamp first, then consider structured courses on Coursera or edX as your learning progresses within your ${timeline} timeline.`, { lineGap: 2 });
      }
      doc.moveDown(0.4);
    }

    if (softSkills.length > 0) {
      checkPageBreak(doc);
      doc.fontSize(12).font("Helvetica-Bold").fillColor("#333333").text("Soft Skills");
      doc.moveDown(0.2);
      renderGapTable(doc, softSkills, timeline, "soft");

      doc.moveDown(0.4);
      // Soft skills note
      doc.fontSize(9).font("Helvetica-Oblique").fillColor("#555555")
        .text("A note on soft skills: Many interpersonal and leadership skills develop most effectively through hands-on experience, mentoring, and real-world practice rather than formal coursework alone. While workshops and online resources can provide frameworks and techniques, the depth of these skills often comes from consistently applying them in professional settings. Consider seeking out projects, volunteer roles, or workplace opportunities that let you practice these skills regularly.", { lineGap: 2 });
    }
    doc.moveDown(0.5);
    return;
  }

  // Explore track or empty skills — blended skills already shown in Section 2, skip here
  sectionBanner(doc, "3. Skill gap analysis", "blue");
  doc.fontSize(11).font("Helvetica").fillColor("#000000");
  if (!state.targetRole) {
    doc.text("To get a personalized skill gap analysis with ratings and course recommendations, start a focused session for one of the recommended career directions above.", { lineGap: 4 });
  } else if (state.skillsAssessmentStatus === "complete") {
    doc.text(`Skills assessment for ${state.targetRole} is marked complete, but no skill records were retrieved for this report. Open the session in the app to view full results.`, { lineGap: 4 });
  } else {
    doc.text("Skills assessment was not completed during this session. To get a full skill gap analysis, consider continuing your session or starting a new one.", { lineGap: 4 });
  }
  doc.moveDown(0.5);
}

// --- Table Helpers ---

function renderSkillsSubtable(
  doc: PDFKit.PDFDocument,
  skills: SkillAssessment[],
  headers: string[],
  rowFn: (s: SkillAssessment) => string[],
): void {
  const colWidths = headers.length === 3 ? [200, 100, 150] : [150, 100, 100, 100];
  const startX = 55;

  // Header row
  const headerY = doc.y;
  doc.fontSize(9).font("Helvetica-Bold").fillColor("#333333");
  let x = startX;
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i], x, headerY, { width: colWidths[i] });
    x += colWidths[i];
  }
  doc.moveDown(0.3);
  doc.moveTo(startX, doc.y).lineTo(startX + colWidths.reduce((a, b) => a + b, 0), doc.y).stroke("#cccccc");
  doc.moveDown(0.3);

  // Data rows
  doc.fontSize(9).font("Helvetica").fillColor("#000000");
  for (const skill of skills) {
    checkPageBreak(doc);
    const cols = rowFn(skill);
    const rowY = doc.y;
    x = startX;
    for (let i = 0; i < cols.length; i++) {
      doc.text(cols[i], x, rowY, { width: colWidths[i] });
      x += colWidths[i];
    }
    doc.moveDown(0.2);
  }
}

function renderGapTable(
  doc: PDFKit.PDFDocument,
  skills: SkillAssessment[],
  timeline: string,
  type: "tech" | "soft",
): void {
  const headers = ["Skill", "Required", "Your Level", "Status", "Suggested Action"];
  const colWidths = [100, 65, 65, 80, 175];
  const startX = 55;

  // Header row
  const headerY = doc.y;
  doc.fontSize(8).font("Helvetica-Bold").fillColor("#333333");
  let x = startX;
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i], x, headerY, { width: colWidths[i] });
    x += colWidths[i];
  }
  doc.moveDown(0.3);
  doc.moveTo(startX, doc.y).lineTo(startX + colWidths.reduce((a, b) => a + b, 0), doc.y).stroke("#cccccc");
  doc.moveDown(0.3);

  // Data rows
  doc.fontSize(8).font("Helvetica").fillColor("#000000");
  for (const skill of skills) {
    checkPageBreak(doc);
    const action = type === "tech" ? suggestTechAction(skill) : suggestSoftAction(skill);
    const cols = [
      skill.skill_name,
      skill.required_proficiency || "-",
      formatRating(skill.user_rating),
      formatGap(skill.gap_category),
      action,
    ];
    const rowY = doc.y;
    x = startX;
    for (let i = 0; i < cols.length; i++) {
      doc.text(cols[i], x, rowY, { width: colWidths[i] });
      x += colWidths[i];
    }
    doc.moveDown(0.3);
  }
}

// --- Suggestion Helpers ---

function suggestTechAction(skill: SkillAssessment): string {
  if (skill.gap_category === "absent") {
    return "Consider starting with free tutorials and introductory courses";
  }
  if (skill.gap_category === "underdeveloped") {
    return "Consider intermediate-level practice projects or structured courses";
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

// --- Formatting Helpers ---

function checkPageBreak(doc: PDFKit.PDFDocument): void {
  if (doc.y > 700) { doc.addPage(); }
}

type BannerTone = "orange" | "green" | "blue" | "purple" | "coral";

const BANNER_HEX: Record<BannerTone, string> = {
  orange: "#e67e22",
  green: "#27ae60",
  blue: "#2874a6",
  purple: "#6c3483",
  coral: "#c0392b",
};

function sectionBanner(doc: PDFKit.PDFDocument, title: string, tone: BannerTone): void {
  checkPageBreak(doc);
  const x = 50;
  const y = doc.y;
  const bannerW = 495;
  const bannerH = 24;
  const r = 10;
  doc.save();
  doc.roundedRect(x, y, bannerW, bannerH, r).fill(BANNER_HEX[tone]);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#ffffff");
  doc.text(title, x + 14, y + 7, { width: bannerW - 28 });
  doc.restore();
  doc.fillColor("#000000");
  doc.y = y + bannerH + 10;
}

function buildDevelopmentSteps(
  state: AgentStateType,
  skills: SkillAssessment[],
): { label: string; content: string }[] {
  const agenda = state.skillDevelopmentAgenda ?? [];
  const steps: { label: string; content: string }[] = [];
  if (agenda.length > 0) {
    agenda.forEach((item, i) => {
      steps.push({ label: `Priority ${i + 1}`, content: item });
    });
  } else if (skills.length > 0) {
    const gaps = skills.filter(s => s.gap_category === "absent" || s.gap_category === "underdeveloped");
    if (gaps.length > 0) {
      steps.push({
        label: "Assess",
        content: "Complete self-assessment of all required skills for your target role.",
      });
      steps.push({
        label: "Foundation",
        content: `Build foundational knowledge in ${gaps.slice(0, 2).map(s => s.skill_name).join(" and ")}.`,
      });
      steps.push({
        label: "Practice",
        content: "Apply skills through projects, exercises, or real-world tasks.",
      });
      steps.push({
        label: "Review",
        content: "Revisit progress and adjust your development plan as needed.",
      });
    }
  }
  return steps;
}

function renderIdpStepPdf(doc: PDFKit.PDFDocument, stepIndex: number, label: string, content: string): void {
  checkPageBreak(doc);
  const colors = ["#e67e22", "#27ae60", "#16a085", "#2874a6", "#6c3483"];
  const c = colors[stepIndex % 5]!;
  const x = 50;
  const w = 495;
  const barH = 22;
  const y0 = doc.y;
  doc.save();
  doc.roundedRect(x, y0, w, barH, 6).fill(c);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#ffffff");
  doc.text(`Step ${String(stepIndex + 1).padStart(2, "0")}: ${label}`, x + 12, y0 + 6, { width: w - 24 });
  doc.restore();
  doc.y = y0 + barH + 6;
  doc.font("Helvetica").fontSize(10).fillColor("#444444").text(content, { width: w - 24, lineGap: 3 });
  doc.fillColor("#000000");
  doc.moveDown(0.45);
}

function renderDayHeaderPdf(doc: PDFKit.PDFDocument, dayNum: number, salmon: boolean): void {
  checkPageBreak(doc);
  const x = 50;
  const y0 = doc.y;
  const w = 160;
  const h = 18;
  const fill = salmon ? "#e57373" : "#7986cb";
  doc.save();
  doc.roundedRect(x, y0, w, h, 5).fill(fill);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#ffffff");
  doc.text(`Day ${dayNum}`, x + 10, y0 + 4, { width: w - 20 });
  doc.restore();
  doc.fillColor("#000000");
  doc.y = y0 + h + 6;
}

function addField(doc: PDFKit.PDFDocument, label: string, value: string): void {
  doc.fontSize(10).font("Helvetica-Bold").fillColor("#555555").text(`${label}: `, { continued: true });
  doc.font("Helvetica").fillColor("#000000").text(value);
}

function formatEducation(level: string | null): string {
  const map: Record<string, string> = {
    high_school: "High School Diploma",
    associate: "Associate's Degree",
    bachelor: "Bachelor's Degree",
    master: "Master's Degree",
    doctoral: "Doctoral Degree",
    other: "Other",
  };
  return level ? map[level] ?? level : "Not provided";
}

function formatRating(rating: string | null): string {
  const map: Record<string, string> = {
    beginner: "Beginner",
    intermediate: "Intermediate",
    advanced: "Advanced",
    expert: "Expert",
    // backward compat for old sessions:
    not_yet_familiar: "New",
    working_knowledge: "Intermediate",
    strong_proficiency: "Strong",
  };
  return rating ? map[rating] ?? rating : "-";
}

function formatGap(gap: string | null): string {
  const map: Record<string, string> = {
    absent: "Needs Development",
    underdeveloped: "Needs Growth",
    strong: "On Track",
  };
  return gap ? map[gap] ?? gap : "-";
}
