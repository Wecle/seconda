import { createWorkspaceContextProviders } from "./context";
import { DEFAULT_AGENT_MAX_STEPS, WORKSPACE_AGENT_PROMPT_VERSION } from "./prompt";
import { createWorkspaceToolRegistry } from "./tools";
import { decideWorkspaceStep } from "./turn-policy";
import { BUILT_IN_CAPABILITIES, type AgentCapability } from "../types";

function workspaceRoot(config: unknown) {
  if (!config || typeof config !== "object" || !("workspaceRoot" in config)) {
    throw new Error("Workspace capability requires a workspace root");
  }
  const root = (config as { workspaceRoot?: unknown }).workspaceRoot;
  if (typeof root !== "string" || !root.trim()) {
    throw new Error("Workspace capability requires a workspace root");
  }
  return root;
}

export const workspaceCapability: AgentCapability = {
  id: BUILT_IN_CAPABILITIES.workspace,
  promptVersion: WORKSPACE_AGENT_PROMPT_VERSION,
  maxSteps: DEFAULT_AGENT_MAX_STEPS,
  createContextProviders(context) {
    return createWorkspaceContextProviders({
      systemPrompt: context.systemPrompt,
      workspaceRoot: workspaceRoot(context.capabilityConfig),
    });
  },
  createToolRegistry(context) {
    const registry = createWorkspaceToolRegistry();
    const toolContext = { workspaceRoot: workspaceRoot(context.capabilityConfig), signal: context.signal };
    return {
      schemas: registry.schemas.bind(registry),
      toAISDKTools: () => registry.toAISDKTools(toolContext),
      toolOrder: ["list_files", "search_files", "read_file"],
    };
  },
  afterStep(context) {
    return decideWorkspaceStep(context.content);
  },
};
