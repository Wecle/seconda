import { createBuiltInCapabilityRegistry } from "@/lib/agent/capabilities/built-ins";
import { interviewCapability } from "@/lib/interview/agent/capability";

export function createApplicationCapabilityRegistry() {
  const registry = createBuiltInCapabilityRegistry();
  registry.register(interviewCapability);
  return registry;
}

export const applicationCapabilityRegistry = createApplicationCapabilityRegistry();
