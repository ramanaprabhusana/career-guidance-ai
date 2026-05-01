import { StateGraph, END } from "@langchain/langgraph";
import { AgentState, type AgentStateType } from "./state.js";
import { analyzerPromptCreator } from "./nodes/analyzer-prompt-creator.js";
import { analyzer } from "./nodes/analyzer.js";
import { fillerGuard } from "./nodes/filler-guard.js";
import { stateUpdater } from "./nodes/state-updater.js";
import { speakerPromptCreator } from "./nodes/speaker-prompt-creator.js";
import { speaker } from "./nodes/speaker.js";
import { summarizerNode, shouldSummarize } from "./nodes/summarizer-node.js";
import { reactExecutor, shouldStartReact } from "./nodes/react-executor.js";

export function buildGraph() {
  // May 01 MVP correction: default career-guidance turns must prioritize state
  // freshness over parallel LLM latency. The speaker prompt is built only after
  // analyzer output has been merged by stateUpdater, preventing same-turn
  // forgetfulness and repeated questions for facts the user just supplied.
  const graph = new StateGraph(AgentState)
    .addNode("analyzerPromptCreator", analyzerPromptCreator)
    .addNode("analyzer", analyzer)
    .addNode("fillerGuard", fillerGuard)
    .addNode("stateUpdater", stateUpdater)
    .addNode("reactExecutor", reactExecutor)
    .addNode("speakerPromptCreator", speakerPromptCreator)
    .addNode("speaker", speaker)
    .addNode("summarizer", summarizerNode)

    .addEdge("__start__", "analyzerPromptCreator")
    .addEdge("analyzerPromptCreator", "analyzer")
    .addEdge("analyzer", "fillerGuard")
    .addEdge("fillerGuard", "stateUpdater")
    .addConditionalEdges(
      "stateUpdater",
      (s: AgentStateType): "react" | "speak" => {
        if (shouldStartReact(s) === "react") return "react";
        return "speak";
      },
      {
        react: "reactExecutor",
        speak: "speakerPromptCreator",
      },
    )
    .addEdge("reactExecutor", "speakerPromptCreator")
    .addEdge("speakerPromptCreator", "speaker")
    .addConditionalEdges("speaker", shouldSummarize, {
      yes: "summarizer",
      no: END,
    })
    .addEdge("summarizer", END);

  return graph.compile();
}
