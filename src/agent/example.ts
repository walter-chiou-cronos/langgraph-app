import dedent from "dedent";
import { createNflAgent, createGeckoTerminalAgent } from ".";

const main = async () => {
  const nflAgent = createNflAgent();
  const stream = await nflAgent.stream(
    {
      messages: dedent`
        when was the last game? who won?
    `,
    },
    {
      streamMode: "values",
    }
  );

  // const geckoTerminalAgent = createGeckoTerminalAgent();
  // const stream = await geckoTerminalAgent.stream(
  //   {
  //     messages: dedent`
  //       what are the trending coins on ethereum mainnet this week? show me the top 5.

  //   `,
  //   },
  //   {
  //     streamMode: "values",
  //   }
  // );

  for await (const { messages } of stream) {
    let msg = messages[messages?.length - 1];
    if (msg?.content) {
      console.log(msg.content);
    } else if (msg?.tool_calls?.length > 0) {
      console.log(msg.tool_calls);
    } else {
      console.log(msg);
    }
    console.log("-----\n");
  }
};

main();
