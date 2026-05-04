import type { AgentStateType } from "../state.js";
import { config } from "../config.js";
import { loadSkillFile, loadPromptTemplate, populateTemplate } from "../utils/prompt-loader.js";
import { getRecentTurns, getConversationSummary, formatCollectedData, formatMissingFields } from "../utils/history-manager.js";

/**
 * Change 4 (BR-12): persona-aware "known facts" block. Lists only the
 * non-null profile facts so the speaker can skip re-asking them. Used for
 * both returning_continue/returning_restart personas AND for same-session
 * role switches where we want to remind the model that we already have the
 * user's background even though the target role changed.
 */
function getKnownFactsBlock(state: AgentStateType): string {
  const facts: string[] = [];
  if (state.jobTitle) facts.push(`- Job title: ${state.jobTitle}`);
  if (state.industry) facts.push(`- Industry: ${state.industry}`);
  if (state.yearsExperience !== null && state.yearsExperience !== undefined) {
    facts.push(`- Years experience: ${state.yearsExperience}`);
  }
  if (state.educationLevel) facts.push(`- Education: ${state.educationLevel}`);
  if (state.location) facts.push(`- Location: ${state.location}`);
  if (state.preferredTimeline) facts.push(`- Preferred timeline: ${state.preferredTimeline}`);
  const explored = (state.exploredRoles ?? [])
    .map((r) => r.role_name)
    .filter(Boolean);
  if (explored.length > 0) {
    facts.push(`- Previously explored roles: ${explored.join(", ")}`);
  }
  if (state.targetRole) facts.push(`- Currently active target: ${state.targetRole}`);
  if (state.previousTargetRole && state.previousTargetRole !== state.targetRole) {
    facts.push(`- Prior plan generated for: ${state.previousTargetRole}`);
  }
  if (facts.length === 0) return "";
  return [
    "WHAT WE ALREADY KNOW ABOUT THIS USER",
    ...facts,
    "",
    "CRITICAL: Do NOT re-ask any of the above. Only ask for fields that are still missing or need explicit confirmation.",
  ].join("\n");
}

function getNoRepeatGuardBlock(state: AgentStateType): string {
  const lines: string[] = [
    "NO-REPEAT / KNOWN-FACT CHECK",
    "Before asking the next question, check active session state, recent raw turns, episodic memory, long-term profile memory, and already captured role/skill ratings.",
    "Do NOT ask again for a target role, timeline, background fact, or skill rating that is already captured unless the user explicitly says it changed or it needs confirmation.",
  ];

  if (state.targetRole) {
    lines.push(`- Active target role already confirmed: ${state.targetRole}`);
  }
  if (state.skills.length > 0) {
    const rated = state.skills.filter((s) => s.user_rating !== null).map((s) => s.skill_name);
    if (rated.length > 0) {
      lines.push(`- Skill ratings already captured: ${rated.slice(0, 12).join(", ")}${rated.length > 12 ? "..." : ""}`);
    }
  }
  if (state.priorEpisodicSummaries.length > 0) {
    lines.push("- Episodic summaries are available for continuity, but active session facts take precedence.");
  }
  lines.push("If the user is unclear or using filler, ask one bounded clarifying question instead of repeating the previous question.");

  return lines.join("\n");
}

function getPhaseCollectedData(state: AgentStateType): Record<string, unknown> {
  const phase = state.currentPhase;

  const fieldMap: Record<string, Record<string, unknown>> = {
    orientation: {
      job_title: state.jobTitle,
      industry: state.industry,
      years_experience: state.yearsExperience,
      education_level: state.educationLevel,
      session_goal: state.sessionGoal,
    },
    exploration_career: {
      interests: state.interests,
      constraints: state.constraints,
      candidate_directions: state.candidateDirections,
    },
    exploration_role_targeting: {
      target_role: state.targetRole,
      skills: state.skills,
      learning_needs: state.learningNeeds,
      learning_needs_complete: state.learningNeedsComplete,
      skills_evaluation_summary: state.skillsEvaluationSummary,
      user_confirmed_evaluation: state.userConfirmedEvaluation,
    },
    planning: {
      recommended_path: state.recommendedPath,
      timeline: state.timeline,
      skill_development_agenda: state.skillDevelopmentAgenda,
      immediate_next_steps: state.immediateNextSteps,
      plan_rationale: state.planRationale,
      shift_intent: state.shiftIntent,
      plan_blocks: state.planBlocks,
    },
  };

  return fieldMap[phase] ?? {};
}

function getCrossPhaseContext(state: AgentStateType): string {
  const lines: string[] = [];

  if (state.currentPhase !== "orientation") {
    if (state.jobTitle) lines.push(`Job title: ${state.jobTitle}`);
    if (state.industry) lines.push(`Industry: ${state.industry}`);
    if (state.yearsExperience !== null) lines.push(`Experience: ${state.yearsExperience} years`);
    if (state.educationLevel) lines.push(`Education: ${state.educationLevel}`);
  }

  if (state.currentPhase !== "orientation") {
    if (state.interests.length > 0) lines.push(`Interests: ${state.interests.join(", ")}`);
    if (state.constraints.length > 0) lines.push(`Constraints: ${state.constraints.join(", ")}`);
    if (state.targetRole) lines.push(`Target role: ${state.targetRole}`);
  }

  if (state.currentPhase === "planning") {
    const gaps = state.skills.filter((s) => s.gap_category === "absent" || s.gap_category === "underdeveloped");
    if (gaps.length > 0) {
      lines.push(`Skills to develop: ${gaps.map((s) => `${s.skill_name} (${s.gap_category})`).join(", ")}`);
    }
    const strengths = state.skills.filter((s) => s.gap_category === "strong");
    if (strengths.length > 0) {
      lines.push(`Strong skills: ${strengths.map((s) => s.skill_name).join(", ")}`);
    }
    // Change 3: prerequisite status for planning phase
    const totalSkills = state.skills.length;
    const ratedSkills = state.skills.filter(s => s.user_rating !== null).length;
    lines.push(`Skills assessment: ${ratedSkills}/${totalSkills} rated`);
    lines.push(`Evaluation confirmed: ${state.userConfirmedEvaluation ? "yes" : "no"}`);
    lines.push(`Learning needs discussed: ${state.learningNeedsComplete ? "yes" : "no"}`);
    if (state.learningNeeds.length > 0) {
      lines.push(`Priority learning areas: ${state.learningNeeds.join(", ")}`);
    }
    // Emit PREREQUISITE WARNING when any gate is unmet — planning speaker/analyzer
    // prompts check for this exact string to block plan generation.
    const allRated = totalSkills > 0 && ratedSkills === totalSkills;
    if (!allRated || !state.learningNeedsComplete || !state.userConfirmedEvaluation) {
      lines.push("PREREQUISITE WARNING: Skills assessment is incomplete. Do NOT generate a plan. Redirect the user back to complete skills assessment, learning preferences, and confirmation.");
    }
    // C2: surface shift_intent and the next unconfirmed plan block so the
    // planning speaker can actually branch on them (previously the orchestrator
    // tracked both but the speaker never saw them).
    if (state.shiftIntent) {
      lines.push(
        "Career shift variant: ACTIVE — lead with an honest financial/emotional caveat, then re-evaluate which prior experience transfers, THEN present the standard plan blocks."
      );
    }
    if (Array.isArray(state.planBlocks) && state.planBlocks.length > 0) {
      const nextBlock = state.planBlocks.find((b) => !b.confirmed) ?? null;
      const totalConfirmed = state.planBlocks.filter((b) => b.confirmed).length;
      lines.push(`Plan block progress: ${totalConfirmed}/${state.planBlocks.length} confirmed`);
      if (nextBlock) {
        lines.push(
          `Next plan block to present: [${nextBlock.id}] ${nextBlock.label} — ${nextBlock.content}`
        );
        lines.push(
          "Present ONLY this block this turn. End by asking the user to confirm or adjust it before moving on."
        );
      } else {
        lines.push(
          "All plan blocks confirmed — offer the export / PDF report as the final step."
        );
      }
    }
  }

  // Change 5 P0 (Apr 14 2026): orchestrator signals that we're in role
  // targeting without a confirmed target role. Speaker MUST ask the user
  // to name a specific role instead of assuming one or presenting skills
  // for an un-confirmed occupation (Apr 12 "Data Entry Keyer" regression).
  if (state.needsRoleConfirmation) {
    lines.push("");
    lines.push("ROLE CONFIRMATION REQUIRED: The user has not yet named a specific target role for this phase.");
    lines.push(
      "INSTRUCTION: Ask the user to pick ONE specific role (e.g. 'Software Engineer', 'Corporate Finance Analyst'). Do NOT introduce a skill assessment, do NOT assume a role from earlier phases, and do NOT invent one. If they already mentioned a role in history, re-confirm it back to them in one sentence and wait for yes/no."
    );
  }

  // Change 5 P0 (Apr 14 2026): reinforce target-role memory so the speaker
  // never re-asks a role that is already on file.
  if (state.targetRole && !state.needsRoleConfirmation) {
    lines.push(`Target role on file: ${state.targetRole} (already confirmed — do NOT re-ask).`);
  }

  // Change 4 (BR-9): same-session role switch recap. Lists the skills that
  // were rehydrated so the speaker can acknowledge them in one sentence and
  // then only ask about the delta skills.
  if (state.roleSwitchContext && !state.roleSwitchAcknowledged) {
    const ctx = state.roleSwitchContext;
    const unrated = state.skills
      .filter((s) => s.user_rating === null)
      .map((s) => s.skill_name);
    lines.push("");
    lines.push(`ROLE SWITCH ACTIVE: ${ctx.from_role} → ${ctx.to_role}`);
    lines.push(`- Shared skills carried over with prior ratings: ${ctx.shared_skills.length}`);
    lines.push(`- Rehydrated ratings: ${ctx.rehydrated_ratings}`);
    if (ctx.shared_skills.length > 0) {
      lines.push(`- Skills already rated (do NOT re-ask): ${ctx.shared_skills.join(", ")}`);
    }
    if (unrated.length > 0) {
      lines.push(`- Skills you should ask about (delta only): ${unrated.join(", ")}`);
    }
    lines.push(
      `INSTRUCTION: Lead with a one-sentence recap ("I've moved your prior ratings for ${ctx.shared_skills.slice(0, 3).join(", ") || "shared skills"} over to ${ctx.to_role}"). Then ask only about the unrated skills. Do NOT re-ask skills you already have ratings for.`,
    );
  }

  // Change 4 (BR-10): active two-role comparison.
  if (state.roleComparisonContext) {
    const rc = state.roleComparisonContext;
    lines.push("");
    lines.push(`ROLE COMPARISON ACTIVE: ${rc.role_a} vs ${rc.role_b}`);
    if (rc.shared_skills.length > 0) {
      lines.push(`- Shared skills: ${rc.shared_skills.join(", ")}`);
    }
    if (rc.unique_a.length > 0) {
      lines.push(`- Unique to ${rc.role_a}: ${rc.unique_a.join(", ")}`);
    }
    if (rc.unique_b.length > 0) {
      lines.push(`- Unique to ${rc.role_b}: ${rc.unique_b.join(", ")}`);
    }
    if (rc.recommended_priority) {
      const label = rc.recommended_priority === "role_a" ? rc.role_a : rc.role_b;
      lines.push(`- Recommended priority: ${label}${rc.rationale ? ` — ${rc.rationale}` : ""}`);
    }
    lines.push(
      "INSTRUCTION: Present the comparison in a structured way (shared / role_a unique / role_b unique). End with a reasoned priority recommendation based on user background, current skill fit, timeline, and constraints. Limit to exactly these 2 roles — do NOT introduce a third.",
    );
  }

  if ((state.reactObservationLog ?? []).length > 0) {
    const observations = state.reactObservationLog
      .slice(-5)
      .map((o) => `- ${o.tool}: ${o.ok ? o.summary : `unavailable (${o.summary})`}`);
    lines.push("");
    lines.push("DEEP RESEARCH OBSERVATIONS");
    lines.push(...observations);
    lines.push(
      "INSTRUCTION: Use these observations as evidence in the answer. Do not expose chain-of-thought or internal tool steps; summarize the evidence, implication, limitation, and next step.",
    );
  }

  // Change 4 (BR-9 cont.): prior plan on file — delta planning callout.
  if (state.currentPhase === "planning" && state.priorPlan) {
    const pp = state.priorPlan;
    const date = new Date(pp.generated_at).toISOString().slice(0, 10);
    lines.push("");
    lines.push(`PRIOR PLAN ON FILE: ${pp.target_role} (generated ${date})`);
    lines.push(
      `INSTRUCTION: The user already has a plan for "${pp.target_role}". The current plan is for a NEW target role (${state.targetRole ?? "unknown"}). Acknowledge the prior plan briefly ("I'll keep your previous plan for ${pp.target_role} on file") and present this new plan as a delta. Do not regenerate scaffolding the user has already seen.`,
    );
  }

  // Change 4 (BR-11): industry cap warning.
  if (
    state.currentPhase === "exploration_career" &&
    (state.candidateIndustries?.length ?? 0) >= 3
  ) {
    lines.push("");
    lines.push(
      `INDUSTRY CAP REACHED: ${state.candidateIndustries.length} of 3 — ${state.candidateIndustries.join(", ")}. Do NOT add more. If the user names another, help them narrow — explain why the existing 3 are the strongest fit for their background and ask which to drop.`,
    );
  }
  if (state.clarificationTopic === "INDUSTRY_CAP_HIT") {
    lines.push(
      "INDUSTRY OVERAGE SIGNAL: The user just named more than 3 industries. Acknowledge each briefly, then help them narrow to 3 using reasoned tradeoffs (fit to background, timeline, constraints).",
    );
  }

  return lines.length > 0 ? lines.join("\n") : "(no cross-phase context)";
}

// OR-003 / SP-002 (2026-05-03): detect conversation loop and inject bounded-options
// guidance so the speaker offers choices instead of repeating the same question.
// Triggered when the Analyzer classifies the turn as "invalid" or "uncertain"
// (AN-001C/AN-001D), or when phaseTurnNumber has advanced significantly with
// no progress on the key missing field.
function getLoopPreventionBlock(state: AgentStateType): string {
  const ao = state.analyzerOutput as unknown as Record<string, unknown> | null;
  const turnFn = ao?.turn_function as string | null | undefined;

  const isInvalidOrUncertain =
    turnFn === "invalid" || turnFn === "uncertain";
  const phase = state.currentPhase;

  // Detect stall: in role targeting, high turn count but skills not started
  const maxTurns = (phase === "exploration_role_targeting" ? 20 : 10);
  const highTurnCount = state.phaseTurnNumber >= Math.floor(maxTurns * 0.6);
  const skillsStalled =
    phase === "exploration_role_targeting" &&
    state.skills.length > 0 &&
    state.skills.filter((s) => s.user_rating !== null).length === 0 &&
    highTurnCount;

  const orientationStalled =
    phase === "orientation" &&
    highTurnCount &&
    (state.jobTitle === null || state.sessionGoal === null);

  if (!isInvalidOrUncertain && !skillsStalled && !orientationStalled) return "";

  const lines: string[] = [
    "",
    "LOOP PREVENTION (OR-003 / SP-002): The user's response did not satisfy the required field, or the conversation has stalled.",
    "INSTRUCTION: Do NOT repeat the same question verbatim.",
  ];

  if (phase === "orientation" && state.sessionGoal === null) {
    lines.push("Offer exactly two bounded options: (A) Explore career directions, (B) Assess readiness for a specific role. Ask the user to pick one.");
  } else if (phase === "exploration_role_targeting" && !state.targetRole) {
    lines.push("The user has not named a target role. Offer 2–3 concrete example roles based on their background (job title, industry, interests) as suggestions, and ask which resonates or if they have something else in mind.");
  } else if (phase === "exploration_role_targeting" && state.skills.length > 0) {
    const unrated = state.skills.filter((s) => s.user_rating === null);
    if (unrated.length > 0) {
      lines.push(`Ask the user to rate just ONE skill this turn: "${unrated[0].skill_name}". Present the four options: beginner / intermediate / advanced / expert.`);
    }
  } else {
    lines.push("Summarize what you already know, then offer 2–4 bounded choices for the most important missing piece of information. Do NOT ask an open-ended question.");
  }

  return lines.join("\n");
}

function getTurnTypeInstructions(turnType: string): string {
  const instructions: Record<string, string> = {
    first_turn: "This is the very first turn. Deliver the opening message for this phase.",
    standard: "Continue the conversation naturally. Acknowledge new information and ask the next question.",
    phase_transition: "The conversation is moving to a new phase. Smoothly transition without naming phases.",
    clarification: "The last response was unclear or off-topic. Ask for clarification naturally.",
    entity_transition: "Moving to the next skill for assessment. Acknowledge the previous rating and present the next skill.",
    termination: "The conversation is ending. Provide a warm closing with key takeaways.",
  };
  return instructions[turnType] ?? instructions.standard;
}

export function speakerPromptCreator(state: AgentStateType): Partial<AgentStateType> {
  // Use fallback for first turn
  if (state.turnType === "first_turn") {
    const opener = config.fallbackMessages.first_turn;

    // Change 4 (BR-12): persona-specific welcome messages.
    // `returning_continue` → offer to keep going with prior target
    // `returning_restart` → kept profile, reset path
    // `new_user` → legacy isReturningUser fall-through for backward compat
    if (state.userPersona === "returning_continue") {
      const prev = state.previousTargetRole ?? state.targetRole;
      const roleNote = prev
        ? `Last time we were working on **${prev}** — your plan and skill ratings are saved.`
        : "I have your background on file from our last session.";
      const options =
        " Want to keep going with that, look at a different role, or compare a couple of roles side by side?";
      const factsSummary = [
        state.jobTitle && `current role: ${state.jobTitle}`,
        state.industry && `industry: ${state.industry}`,
        state.yearsExperience !== null && `${state.yearsExperience} years experience`,
        state.location && `location: ${state.location}`,
      ]
        .filter(Boolean)
        .join(", ");
      const factsLine = factsSummary
        ? `\n\nI already have: ${factsSummary}. No need to re-enter those.`
        : "";
      return {
        speakerPrompt: "",
        speakerOutput: `Welcome back! ${roleNote}${factsLine}${options}`,
      };
    }

    if (state.userPersona === "returning_restart") {
      const prev = state.previousTargetRole ?? "";
      const factsSummary = [
        state.jobTitle && `current role: ${state.jobTitle}`,
        state.industry && `industry: ${state.industry}`,
        state.yearsExperience !== null && `${state.yearsExperience} years experience`,
      ]
        .filter(Boolean)
        .join(", ");
      const factsLine = factsSummary ? ` (${factsSummary})` : "";
      const prevLine = prev
        ? ` We'll set aside the previous **${prev}** path and start fresh on direction.`
        : "";
      return {
        speakerPrompt: "",
        speakerOutput: `Welcome back. I've kept what I know about your background${factsLine}.${prevLine} What would you like to explore?`,
      };
    }

    // Slice S-B (Sr 17, 20): legacy isReturningUser path kept for pre-Change 4
    // sessions where `userPersona` was not yet set.
    if (state.isReturningUser) {
      const priorSummary = (state.priorSessionSummary ?? "").trim();
      const roleNote = state.targetRole ? ` We last discussed your interest in ${state.targetRole}.` : "";
      const episodic = (state.priorEpisodicSummaries ?? []).filter((s) => s && s.trim().length > 0);
      let summaryLine = "";
      if (episodic.length > 0) {
        const mostRecent = episodic[0].trim();
        const extra = episodic.length > 1 ? ` (plus ${episodic.length - 1} earlier session${episodic.length - 1 === 1 ? "" : "s"} on file)` : "";
        summaryLine = ` Here's a quick recap of our most recent session${extra}:\n${mostRecent}\n`;
      } else if (priorSummary) {
        summaryLine = ` Here's a quick recap of where we left off:\n${priorSummary}\n`;
      }
      const resumePrompt = " Would you like to resume from that point, or start a fresh conversation?";
      const welcome = `Welcome back!${roleNote}${summaryLine}${resumePrompt}`;
      return {
        speakerPrompt: "",
        speakerOutput: welcome,
      };
    }
    return {
      speakerPrompt: "",
      speakerOutput: opener,
    };
  }

  const template = loadPromptTemplate("speaker_template.md");
  const speakerSkill = loadSkillFile(state.currentPhase, "speaker.md");
  const collectedData = getPhaseCollectedData(state);
  const schemaFields = config.stateSchema.phases[state.currentPhase] ?? {};
  const { missing_required, missing_optional } = formatMissingFields(
    schemaFields as Record<string, { required?: boolean }>,
    collectedData
  );

  const clarificationNeeded = state.analyzerOutput?.notes &&
    Object.keys(state.analyzerOutput.extracted_fields).length === 0
    ? state.analyzerOutput.notes
    : "(none)";

  // OR-003 / SP-002: loop detection block (injected first so urgency context below can add to it)
  let additionalContext = getLoopPreventionBlock(state);

  // Add urgency context when approaching max turns with incomplete skills
  if (state.currentPhase === "exploration_role_targeting") {
    const maxTurns = config.phaseRegistry.phases["exploration_role_targeting"]?.max_turns ?? 20;
    if (state.phaseTurnNumber >= maxTurns - 2) {
      const skills = state.skills;
      const rated = skills.filter((s) => s.user_rating !== null).length;
      if (skills.length === 0) {
        additionalContext = "\nIMPORTANT: The skills assessment has not started because no target role has been set. Guide the user to name a specific role so skills can be loaded.";
      } else if (rated === 0) {
        additionalContext = "\nIMPORTANT: Skills have been loaded but none have been rated yet. Focus on getting the user to rate at least a few skills before we can build their career plan.";
      } else if (rated < skills.length) {
        additionalContext = `\nIMPORTANT: Only ${rated} of ${skills.length} skills have been assessed (need 100%). Encourage the user to assess the remaining skills so we can build an accurate plan.`;
      }
    }
  }

  // Change 4: prepend "known facts" block to cross_phase_context so the
  // model never re-asks facts already in the persisted profile. This is the
  // single enforcement point for BR-12 inside the prompt template layer.
  const knownFacts = getKnownFactsBlock(state);
  const crossPhase =
    (knownFacts ? `${knownFacts}\n\n` : "") +
    getNoRepeatGuardBlock(state) +
    "\n\n" +
    getCrossPhaseContext(state) +
    additionalContext;

  // Hard-constraint block placed BEFORE phase skill instructions so the LLM
  // cannot re-ask fields that are already in state, even if the phase skill
  // says "ask for X if missing." The missing list can lag; state does not.
  const hardKnownFacts = (() => {
    const facts: string[] = [];
    if (state.jobTitle)        facts.push(`- job_title: "${state.jobTitle}" — DO NOT ASK AGAIN`);
    if (state.industry)        facts.push(`- industry: "${state.industry}" — DO NOT ASK AGAIN`);
    if (state.yearsExperience != null) facts.push(`- years_experience: ${state.yearsExperience} — DO NOT ASK AGAIN`);
    if (state.educationLevel)  facts.push(`- education_level: "${state.educationLevel}" — DO NOT ASK AGAIN`);
    if (state.sessionGoal)     facts.push(`- session_goal: "${state.sessionGoal}" — DO NOT ASK AGAIN`);
    if (state.targetRole)      facts.push(`- target_role: "${state.targetRole}" — CONFIRMED, DO NOT ASK AGAIN`);
    if (state.location)        facts.push(`- location: "${state.location}" — DO NOT ASK AGAIN`);
    if (state.preferredTimeline) facts.push(`- preferred_timeline: "${state.preferredTimeline}" — DO NOT ASK AGAIN`);
    if (!facts.length) return "No fields collected yet.";
    return facts.join("\n") + "\nThe above fields are already captured in structured state. Asking for them again is a hard error.";
  })();

  const prompt = populateTemplate(template, {
    active_phase_name: state.currentPhase,
    hard_known_facts: hardKnownFacts,
    active_phase_speaker_md: speakerSkill,
    phase_collected_data: formatCollectedData(collectedData),
    phase_missing_required: missing_required,
    phase_missing_optional: missing_optional,
    cross_phase_context: crossPhase,
    turn_type: state.turnType,
    turn_type_instructions: getTurnTypeInstructions(state.turnType),
    last_user_message: state.userMessage || "(no message)",
    clarification_needed: clarificationNeeded,
    conversation_summary: getConversationSummary(state.conversationSummary),
    recent_turns: getRecentTurns(state.conversationHistory),
  });

  // Change 10 (SP-003 / OR-003, 2026-05-03): the generic TASK instruction at the
  // end of speaker_template.md ("smoothly conclude") overrides the MANDATORY
  // block-by-block delivery instruction in planning/speaker.md because LLMs
  // weight end-of-prompt text more heavily. Fix: append the next unconfirmed plan
  // block AFTER populateTemplate so this override is always the last text the LLM
  // reads, guaranteeing the block content is presented before anything else.
  let finalPrompt = prompt;
  if (state.currentPhase === "planning") {
    const nextPlanBlock = (state.planBlocks ?? []).find((b) => !b.confirmed) ?? null;
    if (nextPlanBlock) {
      finalPrompt += [
        "",
        "## MANDATORY OVERRIDE — PLAN BLOCK DELIVERY",
        "IGNORE the generic TASK section above for this turn. Your response MUST start with the plan block content below.",
        "Do NOT write any sentence before the block content. Do NOT say 'here is your plan', 'I am preparing', or any similar promise.",
        "",
        `**${nextPlanBlock.label}**`,
        nextPlanBlock.content,
        "",
        "End your message with exactly this question: 'Does this look right, or would you like to adjust anything?'",
      ].join("\n");
    } else if (Array.isArray(state.planBlocks) && state.planBlocks.length > 0) {
      finalPrompt += [
        "",
        "## MANDATORY OVERRIDE — ALL PLAN BLOCKS CONFIRMED",
        "All plan sections have been confirmed. Your response MUST offer to generate the PDF career plan report.",
        "Say something like: 'Your full plan is ready. Would you like me to generate a PDF report you can download?'",
      ].join("\n");
    }
  }

  // Change 4 (BR-9 §4E): after the speaker prompt includes the role-switch
  // recap instruction, mark the switch as acknowledged so the next turn's
  // `determineTransition` guard releases the planning-phase hold.
  const updates: Partial<AgentStateType> = { speakerPrompt: finalPrompt };
  if (state.roleSwitchContext && !state.roleSwitchAcknowledged) {
    updates.roleSwitchAcknowledged = true;
  }
  return updates;
}
