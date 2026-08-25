import type { AgentSkill, AgentSkillProvider } from "./types";
import { skillContentHash } from "./registry";

export type StaticSkillDefinition = {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly instructions: string;
};

export function createStaticSkillProvider(id: string, definitions: readonly StaticSkillDefinition[]): AgentSkillProvider {
  const skills = new Map<string, AgentSkill>();
  for (const definition of definitions) {
    if (skills.has(definition.name)) throw new Error(`Static skill ${definition.name} is defined more than once`);
    const skill = Object.freeze({
      ...definition,
      contentHash: skillContentHash(definition.instructions),
    });
    skills.set(skill.name, skill);
  }
  return {
    id,
    async snapshot() {
      return {
        complete: true,
        skills: [...skills.values()].map((skill) => ({
          name: skill.name,
          description: skill.description,
          version: skill.version,
          contentHash: skill.contentHash,
        })),
      };
    },
    async load(name) {
      return skills.get(name) ?? null;
    },
  };
}
