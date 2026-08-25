import { z } from "zod";
import { AgentToolRegistry, type AgentToolContext } from "../tool-registry";
import type { AgentEventSink } from "../types";
import { CURRENT_AGENT_STEP } from "../capabilities/types";
import { SkillRegistryError, skillToolOutput, type AgentSkillRegistry } from "./registry";
import type { SkillCatalogSnapshot } from "./types";

export type SkillToolContext = AgentToolContext & {
  sessionId: string;
  runId: string;
  userId: string;
  capability: string;
  snapshot: SkillCatalogSnapshot;
  registry: AgentSkillRegistry;
  events: AgentEventSink;
  state: Map<PropertyKey, unknown>;
  loadStep?: number;
};

export const SKILL_LOAD_FAILED = Symbol("skill-load-failed");
export const SKILL_LOADED_STEP = Symbol("skill-loaded-step");
export const SKILL_WRONG_STEP = "SKILL_WRONG_STEP";
export const SKILL_TOOL_ERROR = "SKILL_TOOL_ERROR";
export const SKILL_ALLOWED_STEP = Symbol("skill-allowed-step");
export const SKILL_LOADING_STEP = Symbol("skill-loading-step");

const inputSchema = z.object({ name: z.string().min(1).max(100) }).strict();
const outputSchema = z.object({
  status: z.literal("loaded"),
  name: z.string(),
  version: z.string(),
  contentHash: z.string(),
  instructions: z.string(),
}).strict();

export function createSkillToolRegistry() {
  const registry = new AgentToolRegistry<SkillToolContext>();
  registry.register({
    name: "skill",
    description: "按名称加载当前 Capability 授权的面试方法 Skill。只在需要该方法时调用；Skill 不能扩大工具或业务权限。",
    inputSchema,
    outputSchema,
    async execute(input, context) {
      const { name } = inputSchema.parse(input);
      try {
        const allowedStep = context.state.get(SKILL_ALLOWED_STEP) ?? context.loadStep;
        if (allowedStep !== undefined && context.state.get(CURRENT_AGENT_STEP) !== allowedStep) {
          throw new SkillRegistryError(SKILL_WRONG_STEP, `Skill can only be loaded during model step ${allowedStep}`);
        }
        context.state.set(SKILL_LOADING_STEP, context.state.get(CURRENT_AGENT_STEP));
        const skill = await context.registry.load(name, {
          sessionId: context.sessionId,
          runId: context.runId,
          userId: context.userId,
          capability: context.capability,
          snapshot: context.snapshot,
          signal: context.signal,
        });
        await context.events.append("skill_loaded", {
          name: skill.name,
          version: skill.version,
          contentHash: skill.contentHash,
        });
        context.state.set(SKILL_LOADED_STEP, context.state.get(CURRENT_AGENT_STEP));
        return skillToolOutput(skill);
      } catch (error) {
        const code = error instanceof SkillRegistryError ? error.code : "SKILL_LOAD_FAILED";
        context.state.set(SKILL_LOAD_FAILED, code);
        await context.events.append("skill_load_failed", { name, code });
        throw error;
      }
    },
  });
  return registry;
}
