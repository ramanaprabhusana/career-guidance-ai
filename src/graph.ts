import { StateGraph, END } from "@langchain/langgraph";
import { AgentState, type AgentStateType } from "./state.js";
import { stateUpdater } from "./nodes/state-updater.js";
import { parallelTurn } from "./nodes/parallel-turn.js";
import { summarizerNode, shouldSummarize } from "./nodes/summarizer-node.js";
import { reactExecutor, shouldStartReact } from "./nodes/react-executor.js";

export function buildGraph() {
  // P9: analyzer + speaker LLMs now run concurrently inside the `parallelTurn`
  // node (with inline phase-redirect handling), so the old 4-node sequential
  // chain (analyzerPromptCreator → analyzer → speakerPromptCreator → speaker)
  // collapses into a single combined node. `stateUpdater` still runs
  // downstream to merge analyzer.extracted_fields into canonical state for
  // the NEXT turn, and `summarizer` still gates on `shouldSummarize`.
  //
  // Change 5 P0 (Apr 14 2026): optional ReAct branch between `stateUpdater`
  // and the summarizer. Only reached when `ENABLE_REACT_LOOP=true` AND the
  // orchestrator set `reactIntent` + `pendingReactTool`. Otherwise the graph
  // is byte-identical to the prior topology.
  const graph = new StateGraph(AgentState)
    .addNode("parallelTurn", parallelTurn)
    .addNode("stateUpdater", stateUpdater)
    .addNode("reactExecutor", reactExecutor)
    .addNode("summarizer", summarizerNode)

    .addEdge("__start__", "parallelTurn")
    .addEdge("parallelTurn", "stateUpdater")
    // Combined post-stateUpdater router: enter ReAct branch if flag + intent
    // are set, otherwise fall through to the original summarize-or-END gate.
    .addConditionalEdges(
      "stateUpdater",
      (s: AgentStateType): "react" | "yes" | "no" => {
        if (shouldStartReact(s) === "react") return "react";
        return shouldSummarize(s);
      },
      {
        react: "reactExecutor",
        yes: "summarizer",
        no: END,
      },
    )
    // After ReAct executes, re-enter the summarize-or-END gate.
    .addConditionalEdges("reactExecutor", shouldSummarize, {
      yes: "summarizer",
      no: END,
    })
    .addEdge("summarizer", END);

  return graph.compile();
}
