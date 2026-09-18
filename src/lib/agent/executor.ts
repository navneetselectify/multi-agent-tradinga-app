import { z } from "zod";
import { getGeminiClient } from "@/lib/ai/client";
import { ToolProvider } from "./registry";
import { ToolResult } from "./types";

export const DEFAULT_SYSTEM_INSTRUCTION = `You are a trading assistant.
You can only act through the provided tools.
Do not invent tool results or pretend to execute actions.
Use tools when information is required.
Stop when the user's request is complete.`;

/**
 * Minimal AgentExecutor configuration. Only the system instruction is
 * parameterized so specialized roles can share the same execution loop.
 */
export interface AgentExecutorConfig {
  readonly systemInstruction?: string;
}

export interface AgentResult {
  success: boolean;
  finalResponse: string;
  steps: Array<{
    toolName: string;
    arguments: any;
    result: ToolResult;
  }>;
}

/**
 * Translates Zod object shape to raw OpenAPI schema format expected by Gemini.
 */
export function zodToGeminiSchema(zodObj: z.ZodObject<any>): any {
  const shape = zodObj.shape;
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    let type = "STRING";
    let enumValues: string[] | undefined;
    let description: string | undefined;

    let current = value as any;
    let isOptional = false;

    // Unwrap optionals and nullables
    while (current && current._def) {
      const typeName = current._def.typeName;
      if (typeName === "ZodOptional" || typeName === "ZodNullable") {
        isOptional = true;
        current = current._def.innerType;
      } else {
        break;
      }
    }

    if (current && current._def) {
      const typeName = current._def.typeName;
      if (typeName === "ZodEnum") {
        type = "STRING";
        enumValues = current._def.values;
      } else if (typeName === "ZodNumber") {
        type = "NUMBER";
      } else if (typeName === "ZodString") {
        type = "STRING";
      } else if (typeName === "ZodBoolean") {
        type = "BOOLEAN";
      }

      description = current.description || current._def.description;
    }

    if (!isOptional) {
      required.push(key);
    }

    properties[key] = {
      type,
      ...(enumValues ? { enum: enumValues } : {}),
      ...(description ? { description } : {}),
    };
  }

  return {
    type: "OBJECT",
    properties,
    required: required.length > 0 ? required : undefined,
  };
}

export class AgentExecutor {
  private readonly registry: ToolProvider;
  private readonly systemInstruction: string;

  constructor(registry: ToolProvider, config: AgentExecutorConfig = {}) {
    this.registry = registry;
    this.systemInstruction = config.systemInstruction ?? DEFAULT_SYSTEM_INSTRUCTION;
  }

  /**
   * Executes a user instruction in a conversation loop.
   * Leverages Gemini native function declarations and returns a standardized AgentResult.
   */
  public async execute(instruction: string, maxSteps: number = 5): Promise<AgentResult> {
    const steps: AgentResult["steps"] = [];

    // Create function declarations from registered tools
    const declarations = this.registry.getAll().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: zodToGeminiSchema(tool.inputSchema),
    }));

    const history: any[] = [
      {
        role: "user",
        parts: [{ text: instruction }],
      },
    ];

    let currentStep = 0;

    try {
      while (currentStep < maxSteps) {
        const client = getGeminiClient();
        const response = await client.models.generateContent({
          model: "gemini-2.5-flash",
          contents: history,
          config: {
            systemInstruction: this.systemInstruction,
            tools: declarations.length > 0 ? [{ functionDeclarations: declarations }] : undefined,
            temperature: 0.1,
          },
        });

        const candidate = response.candidates?.[0];
        const parts = candidate?.content?.parts || [];
        const functionCallPart = parts.find((p) => p.functionCall);

        if (functionCallPart && functionCallPart.functionCall) {
          const { name, args } = functionCallPart.functionCall;
          if (!name) {
            throw new Error("Invalid function call: missing tool name.");
          }

          if (process.env.DEBUG_AGENT === "true") {
            console.log(`\n=== [Agent Step ${currentStep + 1}] ===`);
            console.log(`Selected Tool : ${name}`);
            console.log(`Arguments     :`, JSON.stringify(args, null, 2));
          }

          // Call the tool registry (unknown names return existing TOOL_NOT_FOUND result)
          const toolResult = await this.registry.executeTool(name, args);

          if (process.env.DEBUG_AGENT === "true") {
            console.log(`Result        :`, JSON.stringify(toolResult, null, 2));
            console.log(`=============================\n`);
          }

          steps.push({
            toolName: name,
            arguments: args,
            result: toolResult,
          });

          // Model's function call must go to history
          history.push({
            role: "model",
            parts: candidate?.content?.parts || [{ functionCall: { name, args } }],
          });

          // Function result goes to history as user response part
          history.push({
            role: "user",
            parts: [
              {
                functionResponse: {
                  name,
                  response: toolResult,
                },
              },
            ],
          });

          currentStep++;
        } else {
          // No more function calls, final text response is ready
          return {
            success: true,
            finalResponse: response.text || "Task complete.",
            steps,
          };
        }
      }

      // Max steps exceeded
      return {
        success: false,
        finalResponse: "Limit Exceeded: The agent exceeded the maximum allowed trading steps.",
        steps,
      };
    } catch (apiError: any) {
      return {
        success: false,
        finalResponse: `API Error: ${apiError?.message || "An unexpected error occurred during Gemini communication."}`,
        steps,
      };
    }
  }
}
