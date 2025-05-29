import dedent from "dedent";
import { createNflAgent, createGeckoTerminalAgent } from ".";
import mockData from "./openapi/data.json";
import { summarizeJson } from "./jsonSummarizer";

const main = async () => {
  console.log(`====== Original Data ======`);
  console.log(JSON.stringify(mockData, null, 2));

  //who won the last game?
  const stream = await summarizeJson.stream({
    json: JSON.stringify(mockData),
    context: dedent`
      who scored the least points in the last game?
    `,
  });

  // const nflAgent = createNflAgent();

  // const stream = await nflAgent.stream(
  //   {
  //     messages: dedent`who scored the most points last game this season?`,

  //     //   messages: dedent`
  //     //     who scored the most points last game this season?

  //     //     # Instructions
  //     //     - you must call get_game_boxscore tool as first tool call to get the necessary data
  //     // `,
  //   },
  //   {
  //     streamMode: "values",
  //   }
  // );

  // const geckoTerminalAgent = createGeckoTerminalAgent();
  // const stream = await geckoTerminalAgent.stream(
  //   {
  //     messages: dedent`
  //       what is the current avg price of $BTC in USD?
  //   `,
  //   },
  //   {
  //     streamMode: "values",
  //   }
  // );

  for await (const event of stream) {
    console.log(event);
    // const { messages } = event;

    // let msg = messages[messages?.length - 1];
    // if (msg?.content) {
    //   console.log(msg.content);
    // } else if (msg?.tool_calls?.length > 0) {
    //   console.log("Tool calls.");
    //   //console.log(msg.tool_calls);
    // } else {
    //   console.log(msg);
    // }
    console.log("-----\n");
  }
};

main();
