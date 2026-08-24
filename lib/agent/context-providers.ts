import type { ContextProvider, ContextProviderInput, ContextSection } from "./types";

export class ContextProviderRegistry {
  private readonly providers = new Map<string, ContextProvider>();

  register(provider: ContextProvider) {
    if (this.providers.has(provider.id)) throw new Error(`Context provider ${provider.id} is already registered`);
    this.providers.set(provider.id, provider);
    return () => this.providers.delete(provider.id);
  }

  async assemble(input: ContextProviderInput) {
    const sections = (await Promise.all([...this.providers.values()]
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
      .map(async (provider) => {
        const supplied = await provider.provide(input);
        return (Array.isArray(supplied) ? supplied : [supplied]).map((section) => ({
          ...section,
          id: `${provider.id}:${section.id}`,
        }));
      }))).flat();
    const seen = new Set<string>();
    return sections
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
      .filter((section) => {
        if (!section.content.trim()) return false;
        if (seen.has(section.id)) throw new Error(`Duplicate context section ${section.id}`);
        seen.add(section.id);
        return true;
      });
  }
}
export function renderSystemPrompt(sections: readonly ContextSection[]) {
  const trusted = sections.filter((section) => section.trust !== "untrusted-data");
  const untrusted = sections.filter((section) => section.trust === "untrusted-data");
  if (untrusted.length > 0) {
    throw new Error(`Untrusted context cannot be rendered as system instructions: ${untrusted.map(({ id }) => id).join(", ")}`);
  }
  return trusted.map((section) => `## ${section.title}\n\n${section.content.trim()}`).join("\n\n");
}
