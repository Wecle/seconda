import { stepCountIs, streamText, type LanguageModelUsage, type ModelMessage } from "ai";
import { z } from "zod";
import { createProviderModel } from "@/lib/ai/provider-registry";
import type { AgentEventSink, AgentRunInput } from "./types";
import type { AgentCapabilityRegistry } from "./capabilities/registry";
import { CURRENT_AGENT_STEP, type CapabilityContext } from "./capabilities/types";
import { ContextProviderRegistry, renderSystemPrompt } from "./context-providers";
import { prepareModelContext } from "./context-lifecycle";
import { isContextOverflowError } from "./runtime-policy";
import { SkillRegistryError, skillCatalogEventPayload, type AgentSkillRegistry } from "./skills/registry";
import { createSkillCatalogContextProvider } from "./skills/context";
import {
  createSkillToolRegistry,
  SKILL_LOAD_FAILED,
  SKILL_TERMINAL_ACTION_ACTIVE,
  SKILL_TOOL_ERROR,
} from "./skills/tool";
import type { SkillCatalogSnapshot } from "./skills/types";

function getQualityApiKey() {
  const key = process.env.QUALITY_MODEL_API_KEY?.trim();
  if (!key) throw new Error("QUALITY_MODEL_API_KEY must be configured");
  return key;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function usagePayload(usage: LanguageModelUsage) {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}

function toolTraceOutput(toolName: string, output: unknown) {
  if (toolName !== "skill" || !output || typeof output !== "object") return output;
  const record = output as Record<string, unknown>;
  return Object.fromEntries(["status", "name", "version", "contentHash"].flatMap((key) => (
    key in record ? [[key, record[key]]] : []
  )));
}

async function appendModelMessages(events: AgentEventSink, messages: readonly ModelMessage[]) {
  for (const message of messages) {
    const type = message.role === "assistant"
      ? "assistant_message"
      : message.role === "tool"
        ? "tool_result_message"
        : "model_message";
    await events.append(type, { message: structuredClone(message) });
  }
}

export type AgentRuntimeDependencies = {
  capabilities: AgentCapabilityRegistry;
  provider?: ReturnType<typeof createProviderModel>;
  prepareContext?: typeof prepareModelContext;
  stream?: typeof streamText;
  skills?: AgentSkillRegistry;
  loadEvents?: (sessionId: string) => Promise<import("./types").AgentEvent[]>;
};

export async function runAgent(input: AgentRunInput, dependencies: AgentRuntimeDependencies) {
  const capability = dependencies.capabilities.resolve(input.capability);
  const provider = dependencies.provider ?? createProviderModel({
    model: input.model,
    credentialTier: "quality",
    apiKey: getQualityApiKey(),
    responseMode: "conversational",
  });
  if (capability.skillAllowlist?.length && !dependencies.skills) {
    throw new Error(`Capability ${capability.id} requires a skill registry`);
  }
  let createdSkillCatalog = false;
  let skillCatalog: SkillCatalogSnapshot | undefined;
  if (capability.skillAllowlist?.length && dependencies.skills) {
    const events = await (dependencies.loadEvents ?? (async (sessionId: string) => (
      (await import("./repository")).loadAgentEvents(sessionId)
    )))(input.sessionId);
    const persisted = events.filter((event) => (
      event.runId === (input.skillSnapshotRunId ?? input.runId) && event.type === "skill_catalog_snapshotted"
    ));
    if (persisted.length > 1) throw new Error("Agent run has more than one persisted Skill catalog");
    if (persisted[0]) {
      skillCatalog = dependencies.skills.restoreSnapshot(persisted[0].payload, capability.skillAllowlist);
    } else {
      skillCatalog = await dependencies.skills.snapshot({
        sessionId: input.sessionId,
        runId: input.runId,
        userId: input.userId,
        capability: capability.id,
        allowlist: capability.skillAllowlist,
      });
      createdSkillCatalog = true;
    }
  }
  const capabilityContext: CapabilityContext = {
    sessionId: input.sessionId,
    runId: input.runId,
    userId: input.userId,
    model: input.model,
    systemPrompt: input.systemPrompt,
    promptVersion: input.promptVersion,
    capabilityConfig: input.capabilityConfig,
    state: new Map(),
    signal: input.signal,
    events: input.events,
    skillCatalog,
  };
  const capabilityToolsRegistry = capability.createToolRegistry(capabilityContext);
  const skillToolsRegistry = skillCatalog?.skills.length ? createSkillToolRegistry() : undefined;
  const capabilitySchemas = capabilityToolsRegistry.schemas();
  const skillSchemas = skillToolsRegistry?.schemas() ?? [];
  const duplicateTool = capabilitySchemas.find(({ name }) => skillSchemas.some((skill) => skill.name === name));
  if (duplicateTool) throw new Error(`Tool ${duplicateTool.name} is registered by both capability and skill runtime`);
  const tools = {
    ...capabilityToolsRegistry.toAISDKTools(),
    ...(skillToolsRegistry && skillCatalog && dependencies.skills
      ? skillToolsRegistry.toAISDKTools({
          sessionId: input.sessionId,
          runId: input.runId,
          userId: input.userId,
          capability: capability.id,
          snapshot: skillCatalog,
          registry: dependencies.skills,
          signal: input.signal,
          events: input.events,
          state: capabilityContext.state,
          loadStep: capability.skillLoadStep,
        })
      : {}),
  };
  const toolSchemas = [...skillSchemas, ...capabilitySchemas];
  const toolOrder = [
    ...(skillToolsRegistry ? ["skill"] : []),
    ...(capabilityToolsRegistry.toolOrder ?? []),
  ];
  const contextProviders = new ContextProviderRegistry();
  for (const provider of capability.createContextProviders(capabilityContext)) {
    contextProviders.register(provider);
  }
  if (skillCatalog?.skills.length) contextProviders.register(createSkillCatalogContextProvider(skillCatalog));
  const system = renderSystemPrompt(await contextProviders.assemble({
    model: input.model,
    sessionId: input.sessionId,
  }));
  const maxSteps = Math.min(input.maxSteps, capability.maxSteps);

  if (skillCatalog && createdSkillCatalog) {
    await input.events.append("skill_catalog_snapshotted", skillCatalogEventPayload(skillCatalog));
  }
  await input.events.append("run_started", {
    model: input.model,
    capability: capability.id,
    promptVersion: input.promptVersion,
    maxSteps,
    tools: toolSchemas.map(({ name, description }) => ({ name, description })),
  });
  const prepareContext = (trigger?: "pressure" | "context-overflow") => (dependencies.prepareContext ?? prepareModelContext)({
    sessionId: input.sessionId,
    runId: input.runId,
    model: input.model,
    contextWindow: provider.metadata.contextWindow,
    system,
    toolSchemas: toolSchemas.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema: z.toJSONSchema(inputSchema),
    })),
    signal: input.signal,
    liveEvents: input.events,
    publish: input.events.publish,
    modelContextBoundarySequence: input.modelContextBoundarySequence,
    trigger,
  });
  const prepared = await prepareContext();

  let nextBlockIndex = 0;
  const blockIndexes = new Map<string, number>();
  let pendingDelta:
    | { type: "text-delta" | "reasoning-delta"; index: number; text: string }
    | undefined;
  const flushDelta = async () => {
    if (!pendingDelta) return;
    const chunk = pendingDelta;
    pendingDelta = undefined;
    await input.events.append("assistant_chunk", { chunk });
  };
  const blockIndex = (id: string) => {
    const existing = blockIndexes.get(id);
    if (existing !== undefined) return existing;
    const index = nextBlockIndex++;
    blockIndexes.set(id, index);
    return index;
  };
  const appendDelta = async (
    type: "text-delta" | "reasoning-delta",
    id: string,
    text: string,
  ) => {
    const index = blockIndex(id);
    if (pendingDelta && (pendingDelta.type !== type || pendingDelta.index !== index)) {
      await flushDelta();
    }
    pendingDelta ??= { type, index, text: "" };
    pendingDelta.text += text;
    if (pendingDelta.text.length >= 256) await flushDelta();
  };
  const totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let nextContext = prepared;
  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
    capabilityContext.state.set(CURRENT_AGENT_STEP, stepIndex + 1);
    const beforeStep = await capability.beforeStep?.({ ...capabilityContext, step: stepIndex + 1 });
    if (beforeStep?.action === "stop") break;
    if (stepIndex > 0) nextContext = await prepareContext();
    let stepContent: readonly { type: string }[] = [];
    let overflowRetries = 0;
    while (true) {
      let responseMessages: ModelMessage[] = [];
      let completedStep: { finishReason: string; usage: ReturnType<typeof usagePayload> } | undefined;
      let emittedModelOutput = false;
      try {
        const result = (dependencies.stream ?? streamText)({
          model: provider.model,
          system,
          messages: nextContext.messages,
          tools,
          toolOrder,
          providerOptions: provider.metadata.provider === "openai"
            ? { openai: { parallelToolCalls: false } }
            : undefined,
          stopWhen: stepCountIs(1),
          abortSignal: input.signal,
          maxRetries: 0,
          maxOutputTokens: nextContext.maxOutputTokens,
          onStepEnd: (step) => {
            responseMessages = structuredClone(step.response.messages as ModelMessage[]);
            stepContent = step.content;
          },
        });

        for await (const part of result.stream) {
          if (part.type.startsWith("text-") || part.type.startsWith("reasoning-") || part.type.startsWith("tool-")) {
            emittedModelOutput = true;
          }
          if (part.type !== "text-delta" && part.type !== "reasoning-delta") await flushDelta();
          switch (part.type) {
            case "start-step":
              blockIndexes.clear();
              nextBlockIndex = 0;
              await input.events.append("step_started", { step: stepIndex + 1, attempt: overflowRetries + 1 });
              break;
            case "text-start":
              await input.events.append("assistant_chunk", {
                chunk: { type: "block-start", index: blockIndex(part.id), blockType: "text" },
              });
              break;
            case "text-delta":
              await appendDelta("text-delta", part.id, part.text);
              break;
            case "text-end":
              await input.events.append("assistant_chunk", {
                chunk: { type: "block-end", index: blockIndex(part.id), blockType: "text" },
              });
              break;
            case "reasoning-start":
              await input.events.append("assistant_chunk", {
                chunk: { type: "block-start", index: blockIndex(part.id), blockType: "reasoning" },
              });
              break;
            case "reasoning-delta":
              await appendDelta("reasoning-delta", part.id, part.text);
              break;
            case "reasoning-end":
              await input.events.append("assistant_chunk", {
                chunk: { type: "block-end", index: blockIndex(part.id), blockType: "reasoning" },
              });
              break;
            case "tool-call":
              await input.events.append("tool_called", {
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.input,
              });
              break;
            case "tool-result":
              await input.events.append("tool_completed", {
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                output: toolTraceOutput(part.toolName, part.output),
              });
              break;
            case "tool-error":
              if (part.toolName === "skill"
                && !(part.error instanceof SkillRegistryError
                  && part.error.code === SKILL_TERMINAL_ACTION_ACTIVE)
                && !capabilityContext.state.has(SKILL_LOAD_FAILED)) {
                capabilityContext.state.set(SKILL_LOAD_FAILED, SKILL_TOOL_ERROR);
                await input.events.append("skill_load_failed", {
                  name: "invalid-input",
                  code: SKILL_TOOL_ERROR,
                });
              }
              await input.events.append("tool_completed", {
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                error: part.error instanceof Error ? part.error.message : "Tool execution failed",
              });
              break;
            case "finish-step":
              completedStep = { finishReason: part.finishReason, usage: usagePayload(part.usage) };
              break;
            case "error":
              throw part.error;
            case "abort":
              throw input.signal.reason ?? new DOMException(part.reason ?? "Aborted", "AbortError");
            default:
              break;
          }
        }

        await flushDelta();
        await appendModelMessages(input.events, responseMessages);
        const usage = usagePayload(await result.totalUsage);
        totalUsage.inputTokens += usage.inputTokens ?? 0;
        totalUsage.outputTokens += usage.outputTokens ?? 0;
        totalUsage.totalTokens += usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
        await input.events.append("step_completed", completedStep ?? { finishReason: "unknown", usage });
        break;
      } catch (error) {
        await flushDelta();
        if (overflowRetries === 0 && !emittedModelOutput && isContextOverflowError(error)) {
          const previousTokens = nextContext.estimatedTokens;
          const recovered = await prepareContext("context-overflow");
          if (recovered.compacted && recovered.estimatedTokens < previousTokens) {
            await input.events.append("step_retried", {
              step: stepIndex + 1,
              attempt: overflowRetries + 1,
              reason: "context-overflow",
            });
            nextContext = recovered;
            overflowRetries += 1;
            continue;
          }
        }
        throw error;
      }
    }
    const decision = await capability.afterStep?.({
      ...capabilityContext,
      step: stepIndex + 1,
      content: stepContent,
    }) ?? { action: "stop" as const, reason: "capability-step-complete" };
    if (decision.action === "stop") break;
  }
  return totalUsage;
}

export function safeAgentError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return "Agent run was cancelled";
  if (error instanceof DOMException && error.name === "TimeoutError") return "Agent run exceeded its time limit";
  if (error instanceof Error) {
    if (error.message.includes("must be configured")) return error.message;
    if (error.name === "RepeatedToolCallError") return error.message;
  }
  return "Agent run failed. Check the model configuration and try again.";
}

export function modelMessageText(message: ModelMessage) {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .flatMap((part) => {
      const record = asRecord(part);
      return record.type === "text" && typeof record.text === "string" ? [record.text] : [];
    })
    .join("\n");
}
