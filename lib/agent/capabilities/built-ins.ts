import { AgentCapabilityRegistry } from "./registry";
import { workspaceCapability } from "./workspace/capability";

export function createBuiltInCapabilityRegistry() {
  const registry = new AgentCapabilityRegistry();
  registry.register(workspaceCapability);
  return registry;
}

export const builtInCapabilityRegistry = createBuiltInCapabilityRegistry();
