import type { ParsedResume } from "./types";

export function serializeParsedResume(parsed: ParsedResume): string {
  const sections: string[] = [];
  const identity = [parsed.name, parsed.title].filter(Boolean).join("\n");
  if (identity) sections.push(identity);
  if (parsed.summary) sections.push(`Summary\n${parsed.summary}`);

  const contact = parsed.contact
    ? Object.entries(parsed.contact)
        .filter((entry): entry is [string, string] =>
          typeof entry[1] === "string" && entry[1].length > 0)
        .map(([key, value]) => `${key}: ${value}`)
    : [];
  if (contact.length > 0) sections.push(`Contact\n${contact.join("\n")}`);
  if (parsed.skills.length > 0) sections.push(`Skills\n${parsed.skills.join(", ")}`);

  if (parsed.experience.length > 0) {
    sections.push(`Experience\n${parsed.experience.map((entry) => [
      [entry.title, entry.company, entry.period].filter(Boolean).join(" | "),
      ...entry.bullets.map((bullet) => `- ${bullet}`),
    ].join("\n")).join("\n\n")}`);
  }

  if ((parsed.education?.length ?? 0) > 0) {
    sections.push(`Education\n${parsed.education!.map((entry) =>
      [entry.degree, entry.major, entry.school, entry.period].filter(Boolean).join(" | "),
    ).join("\n")}`);
  }

  if ((parsed.projects?.length ?? 0) > 0) {
    sections.push(`Projects\n${parsed.projects!.map((project) => [
      project.name,
      project.description,
      ...(project.tags?.length ? [`Tags: ${project.tags.join(", ")}`] : []),
    ].filter(Boolean).join("\n")).join("\n\n")}`);
  }

  return sections.join("\n\n").trim();
}
