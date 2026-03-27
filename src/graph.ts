import { StateGraph, END } from "@langchain/langgraph";
import { AgentState } from "./state.js";
import type { AgentStateType } from "./state.js";
import { analyzerPromptCreator } from "./nodes/analyzer-prompt-creator.js";
import { analyzer } from "./nodes/analyzer.js";
import { stateUpdater } from "./nodes/state-updater.js";
import { speakerPromptCreator } from "./nodes/speaker-prompt-creator.js";
import { speaker } from "./nodes/speaker.js";

function routeAfterAnalyzer(state: AgentStateType): string {
  // If the analyzer suggests a phase change and we haven't exceeded redirect limit
  if (
    state.newPhase &&
    state.newPhase !== state.currentPhase &&
    state.userChangedPhase < state.maxPhaseRedirects
  ) {
    return "analyzerPromptCreator";
  }
  return "stateUpdater";
}

function routeAfterStateUpdater(state: AgentStateType): string {
  if (state.transitionDecision === "complete") {
    return "__end__";
  }
  return "speakerPromptCreator";
}

export function buildGraph() {
  const graph = new StateGraph(AgentState)
    .addNode("analyzerPromptCreator", analyzerPromptCreator)
    .addNode("analyzer", analyzer)
    .addNode("stateUpdater", stateUpdater)
    .addNode("speakerPromptCreator", speakerPromptCreator)
    .addNode("speaker", speaker)

    // Entry: always start with analyzer prompt creator
    .addEdge("__start__", "analyzerPromptCreator")

    // Analyzer prompt creator → analyzer
    .addEdge("analyzerPromptCreator", "analyzer")

    // Analyzer → conditional: redirect or proceed to state updater
    .addConditionalEdges("analyzer", routeAfterAnalyzer, {
      analyzerPromptCreator: "analyzerPromptCreator",
      stateUpdater: "stateUpdater",
    })

    // State updater → conditional: end or proceed to speaker
    .addConditionalEdges("stateUpdater", routeAfterStateUpdater, {
      speakerPromptCreator: "speakerPromptCreator",
      __end__: END,
    })

    // Speaker prompt creator → speaker
    .addEdge("speakerPromptCreator", "speaker")

    // Speaker → end (one turn complete)
    .addEdge("speaker", END);

  return graph.compile();
}
