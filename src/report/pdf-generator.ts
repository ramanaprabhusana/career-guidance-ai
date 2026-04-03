import PDFDocument from "pdfkit";
import { createWriteStream } from "fs";
import { join } from "path";
import type { AgentStateType } from "../state.js";
import { config } from "../config.js";

export async function generatePDFReport(state: AgentStateType): Promise<string> {
  const outputPath = join(config.paths.root, "exports", `career-plan-${state.sessionId}.pdf`);

  // Ensure exports directory exists
  const { mkdirSync } = await import("fs");
  mkdirSync(join(config.paths.root, "exports"), { recursive: true });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const stream = createWriteStream(outputPath);
    doc.pipe(stream);

    // --- Title ---
    doc.fontSize(24).font("Helvetica-Bold").text("Career Plan Report", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).font("Helvetica").fillColor("#666666")
      .text(`Generated: ${new Date().toLocaleDateString()}`, { align: "center" });
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke("#cccccc");
    doc.moveDown(1);

    // --- Section 1: Profile Summary ---
    sectionHeader(doc, "1. Profile Summary");
    addField(doc, "Current/Recent Role", state.jobTitle ?? "Not provided");
    addField(doc, "Industry", state.industry ?? "Not provided");
    addField(doc, "Years of Experience", state.yearsExperience !== null ? `${state.yearsExperience} years` : "Not provided");
    addField(doc, "Education", formatEducation(state.educationLevel));
    addField(doc, "Session Goal", state.sessionGoal === "explore_options" ? "Explore career options" : "Pursue a specific role");
    if (state.targetRole) {
      addField(doc, "Target Role", state.targetRole);
    }
    doc.moveDown(0.5);

    // --- Section 2: Recommended Path ---
    sectionHeader(doc, "2. Recommended Career Path");
    if (state.recommendedPath) {
      doc.fontSize(11).font("Helvetica").text(state.recommendedPath, { lineGap: 4 });
    } else if (state.targetRole) {
      doc.fontSize(11).font("Helvetica").text(
        `Your target role is ${state.targetRole}. A detailed recommended path could not be generated because the skills assessment was not completed. Complete the skills assessment to receive a personalized career path recommendation.`,
        { lineGap: 4 }
      );
    } else {
      doc.fontSize(11).font("Helvetica").text(
        "A recommended career path could not be generated for this session. Complete a full career coaching session including skills assessment to receive personalized recommendations.",
        { lineGap: 4 }
      );
    }
    doc.moveDown(0.5);

    // --- Section 3: Skill Gap Analysis ---
    sectionHeader(doc, "3. Skill Gap Analysis");
    if (state.skills.length > 0) {
      // Table header
      const tableTop = doc.y;
      doc.fontSize(9).font("Helvetica-Bold");
      doc.text("Skill", 50, tableTop, { width: 150 });
      doc.text("Required Level", 200, tableTop, { width: 120 });
      doc.text("Your Level", 320, tableTop, { width: 100 });
      doc.text("Gap Status", 420, tableTop, { width: 120 });
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke("#cccccc");
      doc.moveDown(0.3);

      doc.fontSize(9).font("Helvetica");
      for (const skill of state.skills) {
        const y = doc.y;
        if (y > 700) { doc.addPage(); }
        doc.text(skill.skill_name, 50, doc.y, { width: 150 });
        const rowY = doc.y - doc.currentLineHeight();
        doc.text(skill.required_proficiency || "-", 200, rowY, { width: 120 });
        doc.text(formatRating(skill.user_rating), 320, rowY, { width: 100 });
        doc.text(formatGap(skill.gap_category), 420, rowY, { width: 120 });
        doc.moveDown(0.2);
      }
    } else {
      doc.fontSize(11).font("Helvetica");
      const status = (state as any).skillsAssessmentStatus;
      if (status === "skipped") {
        doc.text("Skills assessment was not completed during this session. The session reached its turn limit before skills could be evaluated. To get a full skill gap analysis, start a new session and complete the skills assessment phase.", { lineGap: 4 });
      } else if (!state.targetRole) {
        doc.text("No target role was specified during this session, so skills could not be assessed against role requirements. To get a skill gap analysis, start a new session and specify a target role.", { lineGap: 4 });
      } else {
        doc.text("Skills assessment was not completed during this session. To get a full skill gap analysis, continue your session or start a new one focused on your target role.", { lineGap: 4 });
      }
    }
    doc.moveDown(0.5);

    // --- Section 4: Development Timeline ---
    sectionHeader(doc, "4. Development Timeline");
    doc.fontSize(11).font("Helvetica")
      .text(`Estimated timeline: ${state.timeline ?? "To be determined based on your availability and goals."}`, { lineGap: 4 });

    if (state.skillDevelopmentAgenda.length > 0) {
      doc.moveDown(0.3);
      doc.fontSize(11).font("Helvetica-Bold").text("Skill Development Priorities:");
      doc.font("Helvetica");
      for (const item of state.skillDevelopmentAgenda) {
        doc.fontSize(10).text(`  •  ${item}`, { lineGap: 2 });
      }
    }
    doc.moveDown(0.5);

    // --- Section 5: Immediate Next Steps ---
    sectionHeader(doc, "5. Immediate Next Steps");
    if (state.immediateNextSteps.length > 0) {
      for (let i = 0; i < state.immediateNextSteps.length; i++) {
        doc.fontSize(11).font("Helvetica").text(`${i + 1}. ${state.immediateNextSteps[i]}`, { lineGap: 4 });
      }
    } else {
      doc.fontSize(11).font("Helvetica");
      if (state.targetRole) {
        doc.text(`1. Research job postings for ${state.targetRole} to understand current requirements`, { lineGap: 4 });
        doc.text("2. Complete a full career coaching session including skills assessment", { lineGap: 4 });
        doc.text("3. Connect with professionals in your target field for informational interviews", { lineGap: 4 });
      } else {
        doc.text("Complete a full career coaching session to receive personalized next steps.", { lineGap: 4 });
      }
    }
    doc.moveDown(0.5);

    // --- Section 6: Evidence & Sources ---
    sectionHeader(doc, "6. Evidence & Sources");
    doc.fontSize(10).font("Helvetica").fillColor("#444444");
    doc.text("Data sources used in this analysis:", { lineGap: 2 });
    doc.text("  •  O*NET OnLine - Occupational skill and task requirements (U.S. Department of Labor)");
    doc.text("  •  Bureau of Labor Statistics (BLS) - Occupational Employment and Wage Statistics");
    doc.text("  •  USAJOBS - Federal government job postings");
    doc.moveDown(0.5);
    if (state.planRationale) {
      doc.fontSize(10).font("Helvetica-Oblique").text(`Rationale: ${state.planRationale}`, { lineGap: 4 });
    }

    // --- Footer ---
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke("#cccccc");
    doc.moveDown(0.5);
    doc.fontSize(8).font("Helvetica").fillColor("#999999")
      .text("Generated by Career Guidance Assistant. This report is for informational purposes only.", { align: "center" });
    doc.text("Career outcomes depend on many factors. Consult with a professional career advisor for personalized guidance.", { align: "center" });

    doc.end();

    stream.on("finish", () => resolve(outputPath));
    stream.on("error", reject);
  });
}

function sectionHeader(doc: PDFKit.PDFDocument, title: string): void {
  doc.fontSize(14).font("Helvetica-Bold").fillColor("#333333").text(title);
  doc.moveDown(0.3);
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
    not_yet_familiar: "New",
    working_knowledge: "Intermediate",
    strong_proficiency: "Strong",
  };
  return rating ? map[rating] ?? rating : "-";
}

function formatGap(gap: string | null): string {
  const map: Record<string, string> = {
    absent: "Gap - Needs Development",
    underdeveloped: "Partial - Needs Growth",
    strong: "Strong - On Track",
  };
  return gap ? map[gap] ?? gap : "-";
}
