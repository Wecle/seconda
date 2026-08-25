export type AgentSkillSummary = {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly contentHash: string;
};

export type AgentSkill = AgentSkillSummary & {
  readonly instructions: string;
};

export type SkillDiscoveryContext = {
  readonly sessionId: string;
  readonly runId: string;
  readonly userId: string;
  readonly capability: string;
  readonly allowlist: readonly string[];
};

export type SkillCatalogSnapshot = {
  readonly schemaVersion: 1;
  readonly complete: boolean;
  readonly catalogHash: string;
  readonly skills: readonly AgentSkillSummary[];
  readonly sourceByName: Readonly<Record<string, string>>;
};

export type SkillLoadContext = Omit<SkillDiscoveryContext, "allowlist"> & {
  readonly snapshot: SkillCatalogSnapshot;
  readonly signal: AbortSignal;
};

export interface AgentSkillProvider {
  readonly id: string;
  snapshot(context: SkillDiscoveryContext): Promise<{
    complete: boolean;
    skills: readonly AgentSkillSummary[];
  }>;
  load(name: string, context: SkillLoadContext): Promise<AgentSkill | null>;
}
