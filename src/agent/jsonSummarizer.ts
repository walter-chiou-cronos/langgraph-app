import { ChatOpenAI } from "@langchain/openai";

import dedent from "dedent";
import { LRUCache } from "lru-cache";
import { z } from "zod";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import toJsonSchema from "to-json-schema";
import Handlebars from "handlebars";
import handlebarsHelpers from "handlebars-helpers";
import { PromptTemplate } from "@langchain/core/prompts";

handlebarsHelpers({ handlebars: Handlebars });

const MAX_ATTEMPTS = 5;

const jsonToLogiclessTemplatePrompt = PromptTemplate.fromTemplate(dedent`
  # Role
  You are a JSON→Handlebars template generator.

  # Task
  Produce a **logic-less** Handlebars template that flattens the given JSON schema into a concise text summary, minimizing data size.

  # JSON Schema
  \`\`\`json
  {jsonSchema}
  \`\`\`

  # Template Requirements
  **ALLOWED HELPERS (ONLY)**
  - {{#each}}…{{/each}}
  - {{variable}} (dot-path interpolation)

  **DO NOT USE**
  - Any conditionals (if/unless)
  - Comparisons (gt, lt, eq, etc.)
  - Logical helpers (and, or) or custom helpers

  # Output
  - reducerTemplate: A Handlebars text template, without any logic, that summarizes the JSON data. do not include any other text or explanation in your response.
`);

const jsonToLogicBasedTemplatePrompt = PromptTemplate.fromTemplate(dedent`
  # Role
  You are en expert in summarizing large json data into a single concise text message

  # Task
  Create a Handlebars template that extracts the most important information from the provided json schema of the API response data.

  ## Template Syntax Instructions [IMPORTANT]
  You MUST ONLY use these specific Handlebars helpers:
  - {{#if}} ... {{else}} ... {{/if}}
  - {{#unless}} ... {{/unless}}
  - {{#each}} ... {{/each}}
  
  # Json Schema of the input data
  \`\`\`json
  {jsonSchema}
  \`\`\`

  # Instructions
  - You MUST create a Handlebars template that extracts the most important information from the provided json schema of the input data.
  - The Json schema represents the structure of the data that will be passed to the template.
  - Keep important keys such as ID

  # Output Field
  - reducerTemplate: Return ONLY a valid Handlebars text template using ONLY the allowed helpers. Do NOT include any explanations or additional text in your response.
`);

const promptTypes: Record<string, PromptTemplate> = {
  LOGIC_LESS: jsonToLogiclessTemplatePrompt,
  LOGIC_BASED: jsonToLogicBasedTemplatePrompt,
};

/**
 * TODO: implement template caching?
 */
// const cache = new LRUCache({
//   maxSize: 5000000,
//   ttl: 1000 * 60 * 5,
//   sizeCalculation: (n: string) => n.length,
// });

const openaiLLM = new ChatOpenAI({
  model: "gpt-4o",
  apiKey: process.env.OPENAI_API_KEY,
});

const SummarizeJsonStateAnnotation = Annotation.Root({
  json: Annotation<string>({
    reducer: (a, b) => b,
    default: () => "",
  }),
  data: Annotation<any>({
    reducer: (a, b) => b,
    default: () => null,
  }),
  context: Annotation<string | null>({
    reducer: (a, b) => b,
    default: () => null,
  }),
  jsonSchema: Annotation<string | null>({
    reducer: (a, b) => b,
    default: () => null,
  }),
  reducerTemplate: Annotation<string>({
    reducer: (a, b) => b,
    default: () => "",
  }),
  errorMessage: Annotation<string | null>({
    reducer: (a, b) => b,
    default: () => null,
  }),
  attempts: Annotation<number>({
    reducer: (a, b) => b,
    default: () => 0,
  }),
  summary: Annotation<string>({
    reducer: (a, b) => b,
    default: () => "",
  }),
});

const prepareReducerTemplateNode = async (
  state: typeof SummarizeJsonStateAnnotation.State
) => {
  const {
    json,
    context,
    errorMessage,
    reducerTemplate: previousReducerTemplate,
  } = state;
  const data = JSON.parse(json);

  const schema = toJsonSchema(data);
  const jsonSchema = JSON.stringify(schema);

  /**
   * TODO: consider swapping templates based on the context or error message
   */
  const content = await promptTypes.LOGIC_LESS.format({
    jsonSchema,
  });

  const messages = [
    new SystemMessage({
      content: content,
    }),
    errorMessage
      ? new HumanMessage({
          content: dedent`
            # Info
            The previous attempt to create a reducer template failed. Please fix the template to correctly summarize the API response data.

            # Error Message
            ${errorMessage}

            # This is the result of the previous template you provided:
            \`\`\`
            ${previousReducerTemplate}
            \`\`\`

            # Instructions
            Please fix the template correctly
          `,
        })
      : null,
    context
      ? new HumanMessage({
          content: dedent`
            # Conversation Context to consider
            ${context}
          `,
        })
      : null,
  ].filter(Boolean) as BaseMessage[];

  const { reducerTemplate } = await openaiLLM
    .withStructuredOutput(
      z.object({
        reducerTemplate: z
          .string()
          .describe(
            "A handlebars text template for summarizing the data. do not include any other text or explanation."
          ),
      })
    )
    .invoke(messages);

  console.log(`====== Reducer Template ======`);
  console.log(reducerTemplate);

  return {
    reducerTemplate,
    data,
    jsonSchema,
    attempts: state.attempts + 1,
  };
};

const generateSummaryNode = async (
  state: typeof SummarizeJsonStateAnnotation.State
) => {
  const { reducerTemplate, data } = state;

  try {
    const reducer = Handlebars.compile(reducerTemplate);
    const summary = reducer(data);

    console.log(`====== Generated Summary ======`);
    console.log(summary);
    console.log(`\n`);

    console.log({
      originalTextSize: state.json.length,
      optimizedTextSize: summary.length,
    });

    return {
      summary,
      errorMessage: null,
    };
  } catch (error) {
    console.error(error);
    return {
      summary: null,
      errorMessage: dedent`
        An error occurred while parsing the template: ${
          error instanceof Error ? error.message : String(error)
        }
      `,
    };
  }
};

const handleMaxAttemptsErrorNode = async (
  state: typeof SummarizeJsonStateAnnotation.State
) => {
  return {
    summary: dedent`Error summarizing the API response: Max attempts reached.`,
  };
};

const checkSummary = (state: typeof SummarizeJsonStateAnnotation.State) => {
  return state.errorMessage
    ? state.attempts < MAX_ATTEMPTS
      ? "RETRY"
      : "ERROR"
    : "SUCCESS";
};

export const summarizeJson = new StateGraph(SummarizeJsonStateAnnotation)
  .addNode("prepareReducerTemplate", prepareReducerTemplateNode)
  .addNode("generateSummary", generateSummaryNode)
  .addNode("handleMaxAttemptsError", handleMaxAttemptsErrorNode)
  .addEdge(START, "prepareReducerTemplate")
  .addEdge("prepareReducerTemplate", "generateSummary")
  .addConditionalEdges("generateSummary", checkSummary, {
    SUCCESS: END,
    RETRY: "prepareReducerTemplate",
    ERROR: "handleMaxAttemptsError",
  })
  .compile();
