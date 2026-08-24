import { tool, type ToolSet } from "ai";
import { z } from "zod";

export type AgentToolContext = {
  workspaceRoot: string;
  signal: AbortSignal;
};

export type AgentToolDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  execute(input: unknown, context: AgentToolContext): Promise<unknown>;
};

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export class RepeatedToolCallError extends Error {
  constructor(toolName: string) {
    super(`Tool ${toolName} was called repeatedly with identical input`);
    this.name = "RepeatedToolCallError";
  }
}

export class AgentToolRegistry {
  private readonly definitions = new Map<string, AgentToolDefinition>();

  register(definition: AgentToolDefinition) {
    if (this.definitions.has(definition.name)) {
      throw new Error(`Tool ${definition.name} is already registered`);
    }
    this.definitions.set(definition.name, definition);
    return () => this.definitions.delete(definition.name);
  }

  schemas() {
    return [...this.definitions.values()].map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  }

  toAISDKTools(context: AgentToolContext, maxIdenticalCalls = 3): ToolSet {
    const counts = new Map<string, number>();
    return Object.fromEntries(
      [...this.definitions.values()].map((definition) => [
        definition.name,
        tool({
          description: definition.description,
          inputSchema: definition.inputSchema,
          execute: async (rawInput) => {
            context.signal.throwIfAborted();
            const input = definition.inputSchema.parse(rawInput);
            const signature = `${definition.name}:${stableSerialize(input)}`;
            const nextCount = (counts.get(signature) ?? 0) + 1;
            counts.set(signature, nextCount);
            if (nextCount > maxIdenticalCalls) throw new RepeatedToolCallError(definition.name);
            const output = await definition.execute(input, context);
            context.signal.throwIfAborted();
            return definition.outputSchema.parse(output);
          },
        }),
      ]),
    );
  }
}
