// import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";

import dedent from "dedent";
import { openApiToTools } from "./utils/openApiToTools";
import nflApi from "./openapi/processed_nfl_v7_openapi.json";
import geckoTerminalApi from "./openapi/processed_gecko_terminal_openapi.json";
import type { OpenApi } from "openapi-v3";
import { createReactAgent } from "./reactAgent";

const openaiLLM = new ChatOpenAI({
  model: "gpt-4o",
  apiKey: process.env.OPENAI_API_KEY,
});

export const createNflAgent = () => {
  const nflTools = openApiToTools(
    nflApi as OpenApi,
    process.env.NFL_API_KEY as string
  );

  const agent = createReactAgent({
    llm: openaiLLM,
    tools: [...nflTools],
    prompt: dedent`
      You must specify the reasoning steps and objectives before calling any tools.
    `,
  });

  return agent;
};

export const createGeckoTerminalAgent = () => {
  const geckoTerminalTools = openApiToTools(
    geckoTerminalApi as OpenApi,
    process.env.GECKO_TERMINAL_API_KEY as string
  );

  const agent = createReactAgent({
    llm: openaiLLM,
    tools: [...geckoTerminalTools],
  });

  return agent;
};
