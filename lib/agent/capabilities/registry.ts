import type { AgentCapability, AgentCapabilityId } from "./types";

export class AgentCapabilityRegistry {
  private readonly capabilities = new Map<AgentCapabilityId, AgentCapability>();

  register(capability: AgentCapability) {
    if (this.capabilities.has(capability.id)) {
      throw new Error(`Capability ${capability.id} is already registered`);
    }
    this.capabilities.set(capability.id, capability);
    return () => {
      if (this.capabilities.get(capability.id) !== capability) return false;
      return this.capabilities.delete(capability.id);
    };
  }

  resolve(id: AgentCapabilityId) {
    const capability = this.capabilities.get(id);
    if (!capability) throw new Error(`Unknown agent capability: ${id}`);
    return capability;
  }
}
