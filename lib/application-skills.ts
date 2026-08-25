import { AgentSkillRegistry } from "@/lib/agent/skills/registry";
import { createInterviewSkillProvider } from "@/lib/interview/agent/skills/built-ins";

export function createApplicationSkillRegistry() {
  const registry = new AgentSkillRegistry();
  registry.registerProvider(createInterviewSkillProvider());
  return registry;
}

export const applicationSkillRegistry = createApplicationSkillRegistry();
