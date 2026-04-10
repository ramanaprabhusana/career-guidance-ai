import { StateGraph, END } from "@langchain/langgraph";
import { AgentState } from "./state.js";
import { stateUpdater } from "./nodes/state-updater.js";
import { parallelTurn } from "./nodes/parallel-turn.js";
import { summarizerNode, shouldSummarize } from "./nodes/summarizer-node.js";

export function buildGraph() {
  // P9: analyzer + speaker LLMs now run concurrently inside the `parallelTurn`
  // node (with inline phase-redirect handling), so the old 4-node sequential
  // chain (analyzerPromptCreator → analyzer → speakerPromptCreator → speaker)
  // collapses into a single combined node. `stateUpdater` still runs
  // downstream to merge analyzer.extracted_fields into canonical state for
  // the NEXT turn, and `summarizer` still gates on `shouldSummarize`.
  const graph = new StateGraph(AgentState)
    .addNode("parallelTurn", parallelTurn)
    .addNode("stateUpdater", stateUpdater)
    .addNode("summarizer", summarizerNode)

    .addEdge("__start__", "parallelTurn")
    .addEdge("parallelTurn", "stateUpdater")
    .addConditionalEdges("stateUpdater", shouldSummarize, {
      yes: "summarizer",
      no: END,
    })
    .addEdge("summarizer", END);

  return graph.compile();
}
