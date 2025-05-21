import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";

import dedent from "dedent";
import { tool } from "@langchain/core/tools";
import axios from "axios";
import {
  openApiToTools,
  preprocessOpenApiJsonWithLLM,
} from "./utils/openApiToTools";
import nflApi from "./openapi/processed_nfl_v7_openapi.json";
import geckoTerminalApi from "./openapi/processed_gecko_terminal_openapi.json";
import type { OpenApi } from "openapi-v3";

const openaiLLM = new ChatOpenAI({
  model: "gpt-4o",
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Tool example:
 */
const getNflCurrentSeasonSchedule = tool(
  async () => {
    const { data } = await axios.get(
      `https://api.sportradar.com/nfl/official/trial/v7/en/games/current_season/schedule.json`,
      {
        headers: {
          // trail api key
          ["x-api-key"]: process.env.NFL_API_KEY,
        },
      }
    );
    console.log({ data });
    return data;
  },
  {
    name: "get_nfl_current_season_schedule",
    description: dedent`
      Get NFL Current Season Schedule. NFL Current Season Schedule provides schedule information for the current season, including venue and broadcast info, and scoring results by quarter.
    `,
  }
);

export const createNflAgent = () => {
  const nflTools = openApiToTools(
    nflApi as OpenApi,
    process.env.NFL_API_KEY as string
  );

  const agent = createReactAgent({
    llm: openaiLLM,
    tools: [...nflTools],
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
