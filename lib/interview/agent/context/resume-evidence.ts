import { createHash } from "node:crypto";

export type ResumeEvidenceRecord = {
  id: string;
  kind: "profile" | "skill" | "experience" | "project" | "education" | "raw";
  label: string;
  content: string;
};

export type ResumeEvidenceIndex = {
  overview: string;
  directory: Array<Pick<ResumeEvidenceRecord, "id" | "kind" | "label">>;
  records: ResumeEvidenceRecord[];
  rawText: string;
};

export function indexResumeEvidence(
  parsedResume: unknown,
  rawText: string,
): ResumeEvidenceIndex {
  const resume = toRecord(parsedResume);
  const records: ResumeEvidenceRecord[] = [];
  addRecord(records, "profile", "profile", "候选人概览", {
    name: resume.name,
    title: resume.title,
    summary: resume.summary,
  });
  for (const [index, skill] of toArray(resume.skills).entries()) {
    addRecord(records, "skill", `skill:${index}`, String(skill), skill);
  }
  for (const [index, experience] of toArray(resume.experience).entries()) {
    const value = toRecord(experience);
    addRecord(
      records,
      "experience",
      `experience:${index}`,
      [value.company, value.title].filter(Boolean).join(" · ") || `经历 ${index + 1}`,
      value,
    );
  }
  for (const [index, project] of toArray(resume.projects).entries()) {
    const value = toRecord(project);
    addRecord(
      records,
      "project",
      `project:${index}`,
      String(value.name ?? `项目 ${index + 1}`),
      value,
    );
  }
  for (const [index, education] of toArray(resume.education).entries()) {
    const value = toRecord(education);
    addRecord(
      records,
      "education",
      `education:${index}`,
      String(value.school ?? `教育 ${index + 1}`),
      value,
    );
  }
  const overview = JSON.stringify({
    name: resume.name ?? "",
    title: resume.title ?? "",
    summary: resume.summary ?? "",
    skills: toArray(resume.skills).slice(0, 20),
    evidenceDirectory: records.map(({ id, kind, label }) => ({ id, kind, label })),
  });
  return {
    overview: overview.slice(0, 4000),
    directory: [
      ...records.map(({ id, kind, label }) => ({ id, kind, label })),
      { id: "resume:raw", kind: "raw" as const, label: "简历原文（仅按需）" },
    ],
    records,
    rawText,
  };
}

export function loadResumeEvidence(
  index: ResumeEvidenceIndex,
  evidenceIds: readonly string[],
) {
  const records: ResumeEvidenceRecord[] = [];
  const missingIds: string[] = [];
  for (const id of evidenceIds) {
    if (id === "resume:raw") {
      records.push({ id, kind: "raw", label: "简历原文", content: index.rawText.slice(0, 8000) });
      continue;
    }
    const record = index.records.find((item) => item.id === id);
    if (record) records.push(record);
    else missingIds.push(id);
  }
  return { records, missingIds };
}

function addRecord(
  records: ResumeEvidenceRecord[],
  kind: ResumeEvidenceRecord["kind"],
  path: string,
  label: string,
  value: unknown,
) {
  const content = JSON.stringify(value).slice(0, 2000);
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 10);
  records.push({ id: `${path}:${hash}`, kind, label, content });
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
