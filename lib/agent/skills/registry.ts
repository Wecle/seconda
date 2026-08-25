import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  AgentSkill,
  AgentSkillProvider,
  AgentSkillSummary,
  SkillCatalogSnapshot,
  SkillDiscoveryContext,
  SkillLoadContext,
} from "./types";

const providerIdSchema = z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/).max(100);
const skillNameSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100);
const skillSummarySchema = z.object({
  name: skillNameSchema,
  description: z.string().trim().min(1).max(500),
  version: z.string().trim().min(1).max(64),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();
const skillSchema = skillSummarySchema.extend({
  instructions: z.string().trim().min(1).max(8_000),
}).strict();
export const MAX_SKILL_TOOL_OUTPUT_SERIALIZED_CHARS = 8_000;
const persistedCatalogSchema = z.object({
  catalogVersion: z.literal(1),
  complete: z.boolean(),
  catalogHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  skills: z.array(skillSummarySchema.extend({ providerId: providerIdSchema }).strict()),
}).strict();

export type SkillRegistryErrorCode =
  | "SKILL_NOT_VISIBLE"
  | "SKILL_UNAVAILABLE"
  | "SKILL_SNAPSHOT_MISMATCH"
  | "SKILL_WRONG_STEP"
  | "SKILL_TERMINAL_ACTION_ACTIVE"
  | "INVALID_SKILL";

export class SkillRegistryError extends Error {
  constructor(readonly code: SkillRegistryErrorCode, message: string) {
    super(message);
    this.name = "SkillRegistryError";
  }
}

export function skillContentHash(instructions: string) {
  return `sha256:${createHash("sha256").update(instructions, "utf8").digest("hex")}`;
}

export function skillToolOutput(skill: AgentSkill) {
  return {
    status: "loaded" as const,
    name: skill.name,
    version: skill.version,
    contentHash: skill.contentHash,
    instructions: skill.instructions,
  };
}

export function skillCatalogEventPayload(snapshot: SkillCatalogSnapshot) {
  return {
    catalogVersion: snapshot.schemaVersion,
    complete: snapshot.complete,
    catalogHash: snapshot.catalogHash,
    skills: snapshot.skills.map((skill) => ({
      ...skill,
      providerId: snapshot.sourceByName[skill.name],
    })),
  };
}

function catalogHash(skills: readonly AgentSkillSummary[]) {
  return skillContentHash(JSON.stringify(skills.map(({ name, description, version, contentHash }) => ({
    name,
    description,
    version,
    contentHash,
  }))));
}

function freezeSummary(value: AgentSkillSummary): AgentSkillSummary {
  return Object.freeze({ ...value });
}

export class AgentSkillRegistry {
  private readonly providers = new Map<string, AgentSkillProvider>();

  registerProvider(provider: AgentSkillProvider) {
    const id = providerIdSchema.parse(provider.id);
    if (this.providers.has(id)) throw new Error(`Skill provider ${id} is already registered`);
    this.providers.set(id, provider);
    return () => this.providers.delete(id);
  }

  async snapshot(context: SkillDiscoveryContext): Promise<SkillCatalogSnapshot> {
    const allowed = new Set(context.allowlist.map((name) => skillNameSchema.parse(name)));
    const summaries = new Map<string, AgentSkillSummary>();
    const sourceByName: Record<string, string> = {};
    let complete = true;

    for (const provider of [...this.providers.values()].sort((left, right) => left.id.localeCompare(right.id))) {
      const supplied = await provider.snapshot(context);
      complete &&= supplied.complete;
      for (const rawSummary of supplied.skills) {
        const summary = skillSummarySchema.parse(rawSummary);
        if (!allowed.has(summary.name)) continue;
        if (summaries.has(summary.name)) {
          throw new Error(`Skill ${summary.name} is registered more than once in this scope`);
        }
        summaries.set(summary.name, freezeSummary(summary));
        sourceByName[summary.name] = provider.id;
      }
    }

    const skills = Object.freeze([...summaries.values()].sort((left, right) => left.name.localeCompare(right.name)));
    return Object.freeze({
      schemaVersion: 1 as const,
      complete,
      catalogHash: catalogHash(skills),
      skills,
      sourceByName: Object.freeze({ ...sourceByName }),
    });
  }

  restoreSnapshot(payload: unknown, allowlist: readonly string[]): SkillCatalogSnapshot {
    const parsed = persistedCatalogSchema.safeParse(payload);
    if (!parsed.success) {
      throw new SkillRegistryError("INVALID_SKILL", "Persisted Skill catalog is invalid");
    }
    const allowed = new Set(allowlist.map((name) => skillNameSchema.parse(name)));
    const seen = new Set<string>();
    const sourceByName: Record<string, string> = {};
    const skills = parsed.data.skills.map(({ providerId, ...summary }) => {
      if (!allowed.has(summary.name) || seen.has(summary.name)) {
        throw new SkillRegistryError("SKILL_SNAPSHOT_MISMATCH", "Persisted Skill catalog no longer matches the capability scope");
      }
      seen.add(summary.name);
      sourceByName[summary.name] = providerId;
      return freezeSummary(summary);
    }).sort((left, right) => left.name.localeCompare(right.name));
    if (catalogHash(skills) !== parsed.data.catalogHash) {
      throw new SkillRegistryError("SKILL_SNAPSHOT_MISMATCH", "Persisted Skill catalog hash is invalid");
    }
    return Object.freeze({
      schemaVersion: 1 as const,
      complete: parsed.data.complete,
      catalogHash: parsed.data.catalogHash,
      skills: Object.freeze(skills),
      sourceByName: Object.freeze(sourceByName),
    });
  }

  async load(name: string, context: SkillLoadContext): Promise<AgentSkill> {
    const parsedName = skillNameSchema.safeParse(name);
    const expected = parsedName.success
      ? context.snapshot.skills.find((skill) => skill.name === parsedName.data)
      : undefined;
    if (!parsedName.success || !expected) {
      throw new SkillRegistryError("SKILL_NOT_VISIBLE", "Skill is not available in this capability scope");
    }
    const providerId = context.snapshot.sourceByName[expected.name];
    const provider = providerId ? this.providers.get(providerId) : undefined;
    if (!provider) {
      throw new SkillRegistryError("SKILL_UNAVAILABLE", "Skill provider is no longer available");
    }

    context.signal.throwIfAborted();
    const rawSkill = await provider.load(expected.name, context);
    context.signal.throwIfAborted();
    if (!rawSkill) throw new SkillRegistryError("SKILL_UNAVAILABLE", "Skill is no longer available");

    let skill: AgentSkill;
    try {
      skill = skillSchema.parse(rawSkill);
    } catch {
      throw new SkillRegistryError("INVALID_SKILL", "Skill content is invalid");
    }
    if (skill.name !== expected.name
      || skill.description !== expected.description
      || skill.version !== expected.version
      || skill.contentHash !== expected.contentHash
      || skillContentHash(skill.instructions) !== expected.contentHash) {
      throw new SkillRegistryError("SKILL_SNAPSHOT_MISMATCH", "Skill changed after the run snapshot was created");
    }
    if ([...JSON.stringify(skillToolOutput(skill))].length > MAX_SKILL_TOOL_OUTPUT_SERIALIZED_CHARS) {
      throw new SkillRegistryError("INVALID_SKILL", "Serialized Skill content exceeds the model-input boundary");
    }
    return Object.freeze({ ...skill });
  }
}
