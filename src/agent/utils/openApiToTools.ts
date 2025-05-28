import { tool, type DynamicStructuredTool } from "@langchain/core/tools";
import axios from "axios";
import { z } from "zod";
import type { OpenApi, OpenApiOperation, OpenApiPaths } from "openapi-v3";
import { ChatOpenAI } from "@langchain/openai";
import dedent from "dedent";

/**
 * Zod schema for the LLM response.
 */
const toolNameSchema = z.object({
  toolNames: z
    .array(
      z.object({
        path: z.string(),
        method: z.string(),
        name: z.string().max(64).describe("The unique tool name of this API"),
      })
    )
    .describe("A list of tool names for the API endpoints"),
});

const openaiLLM = new ChatOpenAI({
  model: "gpt-4o",
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Helper to normalize a string to snake_case and truncate to 64 characters if needed.
 * @param input - The string to normalize.
 * @returns A normalized string in snake_case.
 */
const normalizeToSnakeCase = (input: string): string => {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+/g, "_") // Replace non-alphanumeric characters with underscores
    .replace(/_+/g, "_") // Collapse multiple underscores
    .replace(/^_|_$/g, ""); // Remove leading or trailing underscores

  return normalized.length > 64 ? normalized.slice(0, 64) : normalized;
};

/**
 * Preprocesses and normalizes an OpenAPI JSON object using an LLM to generate tool names.
 * - Replaces `path.summary` with a normalized tool name.
 * - Updates `path.description` if not provided (uses `path.summary` as fallback).
 * @param openApiJson - The OpenAPI 3.0 JSON object to preprocess.
 * @returns A normalized OpenAPI JSON object.
 */
export async function preprocessOpenApiJsonWithLLM(
  openApiJson: OpenApi
): Promise<OpenApi> {
  if (!openApiJson || !openApiJson.openapi || !openApiJson.paths) {
    throw new Error("Invalid OpenAPI JSON: Missing required fields.");
  }

  const endpoints: { path: string; method: string; summary: string }[] = [];

  // Collect all paths, methods, and summaries
  Object.entries(openApiJson.paths).forEach(([path, methods]) => {
    Object.entries(methods as Record<string, OpenApiOperation>).forEach(
      ([method, details]) => {
        const summary =
          details.summary || `Tool for ${method.toUpperCase()} ${path}`;
        endpoints.push({ path, method, summary });
      }
    );
  });

  // Construct the LLM prompt
  const formattedEndpoints = endpoints
    .map(
      (endpoint, index) =>
        `${index + 1}. Method: ${endpoint.method.toUpperCase()}, Path: ${
          endpoint.path
        }, Summary: ${endpoint.summary}`
    )
    .join("\n");

  const prompt = dedent`
    # Task
    Generate unique tool names for the following API endpoints:
    ${formattedEndpoints}

    # Instructions
    - The tool names must be in snake_case and no longer than 64 characters.
    - The tool name should be prefixed with the HTTP method (e.g., get_user_data, where method is GET).
    
    # Output
    Return the tool names as a JSON array of objects with the following structure:
    [
      {
        "path": "string",
        "method": "string",
        "name": "string"
      }
    ]
  `;

  // Use the LLM with structured output
  const response = await openaiLLM
    .withStructuredOutput(toolNameSchema)
    .invoke(prompt);

  // Validate and parse the LLM response
  const toolNames = response.toolNames;

  // Create a map of tool names for quick lookup
  const toolNameMap = toolNames.reduce((acc, item) => {
    acc[`${item.path.toLowerCase()}:${item.method.toLowerCase()}`] =
      item.name.toLowerCase();
    return acc;
  }, {} as Record<string, string>);

  // Normalize the OpenAPI JSON
  const normalizedPaths: OpenApiPaths = {};

  Object.entries(openApiJson.paths).forEach(([path, methods]) => {
    const normalizedMethods: Record<string, OpenApiOperation> = {};

    Object.entries(methods as Record<string, OpenApiOperation>).forEach(
      ([method, details]) => {
        const key = `${path.toLowerCase()}:${method.toLowerCase()}`;
        const normalizedToolName =
          toolNameMap[key] || normalizeToSnakeCase(key);

        normalizedMethods[method] = {
          ...details,
          summary: normalizedToolName, // Replace summary with the normalized tool name
          description:
            details.description || details.summary || normalizedToolName, // Use summary or tool name as fallback for description
        };
      }
    );

    normalizedPaths[path] = normalizedMethods;
  });

  // Return the updated OpenAPI JSON
  return {
    ...openApiJson,
    paths: normalizedPaths,
  };
}

/**
 * Maps OpenAPI types to Zod types.
 */
const mapOpenApiTypeToZod = (type: string): any => {
  switch (type) {
    case "string":
      return z.string();
    case "integer":
      return z.number().int();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(z.any()); // Default to an array of any type
    default:
      console.warn(`Unsupported type '${type}', defaulting to string.`);
      return z.string();
  }
};

/**
 * Extracts security headers from OpenAPI JSON.
 * @param openApiJson - The OpenAPI 3.0 JSON object.
 * @param apiKey - The API key for authentication.
 * @returns An object containing the security headers.
 */
const getSecurityHeaders = (
  openApiJson: any,
  apiKey: string
): Record<string, string> => {
  const securitySchemes = openApiJson.components?.securitySchemes || {};
  const security = openApiJson.security || [];

  const headers: Record<string, string> = {};

  security.forEach((scheme: Record<string, any>) => {
    Object.keys(scheme).forEach((schemeName) => {
      const schemeDetails = securitySchemes[schemeName];
      if (schemeDetails?.type === "apiKey" && schemeDetails?.in === "header") {
        headers[schemeDetails.name] = apiKey;
      }
    });
  });

  return headers;
};

/**
 * Converts an OpenAPI 3.0 JSON object into an array of LangGraphJS tools.
 * @param openApiJson - The OpenAPI 3.0 JSON object.
 * @param apiKey - The API key for authentication.
 * @returns An array of LangGraphJS tools.
 */
export function openApiToTools(
  openApiJson: OpenApi,
  apiKey: string,
  onSuccessHook: (response: any) => Promise<any> = async (r) => r
): DynamicStructuredTool[] {
  if (!openApiJson || !openApiJson.openapi || !openApiJson.paths) {
    throw new Error("Invalid OpenAPI JSON: Missing required fields.");
  }

  const tools: DynamicStructuredTool[] = [];
  const securityHeaders = getSecurityHeaders(openApiJson, apiKey);

  // Iterate over paths in the OpenAPI JSON
  Object.entries(openApiJson.paths).forEach(([path, methods]) => {
    Object.entries(methods).forEach(([method, details]) => {
      // assuming the summary is the tool name
      const toolName = normalizeToSnakeCase(
        details.summary || `${method}_${path}`
      );

      console.log("Tool name:", toolName);
      const toolDescription = details.description || "No description provided.";

      // Extract parameters and construct a Zod schema
      const parameters = details.parameters || [];
      const inputSchema = z.object(
        parameters.reduce((schema: Record<string, any>, param: any) => {
          const paramType = param.schema?.type || "string"; // Default to string if type is missing
          schema[param.name] = mapOpenApiTypeToZod(paramType).describe(
            param.description || "No description provided."
          );

          if (!param.required) {
            schema[param.name] = schema[param.name].optional();
          }
          return schema;
        }, {})
      );

      const newTool = tool(
        async (inputs: Record<string, any>) => {
          // Construct the URL
          let url = path;
          const queryParams: Record<string, any> = {};

          parameters.forEach((param: any) => {
            if (param.in === "path") {
              url = url.replace(`{${param.name}}`, inputs[param.name]);
            } else if (param.in === "query") {
              queryParams[param.name] = inputs[param.name];
            }
          });

          const serverUrl = openApiJson.servers?.[0]?.url || "";
          const normalizedServerUrl = serverUrl.endsWith("/")
            ? serverUrl.slice(0, -1)
            : serverUrl;
          const normalizedUrl = url.startsWith("/") ? url.slice(1) : url;
          const requestUrl = `${normalizedServerUrl}/${normalizedUrl}`;
          console.log("Request URL:", requestUrl);
          console.log("Query Params:", queryParams);

          try {
            // Make the HTTP request with authentication headers
            const response = await axios({
              method,
              url: requestUrl,
              params: queryParams,
              headers: {
                ...securityHeaders, // Include security headers
              },
            });

            if (onSuccessHook) {
              return await onSuccessHook(response.data);
            }

            return response.data;
          } catch (error) {
            if (axios.isAxiosError(error)) {
              // Handle Axios-specific error
              console.error("Axios error:", error.message);
              console.error("Response data:", error.response?.data);
              throw new Error(`API request failed: ${error.message}`);
            } else {
              // Handle non-Axios errors
              console.error("Unexpected error:", error);
              throw new Error(
                `API request failed: ${error || "Unknown error"}`
              );
            }
          }
        },
        {
          name: toolName,
          description: toolDescription,
          schema: inputSchema,
        }
      );

      tools.push(newTool);
    });
  });

  return tools;
}
