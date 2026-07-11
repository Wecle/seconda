import assert from "node:assert/strict";
import test from "node:test";
import { indexResumeEvidence, loadResumeEvidence } from "./resume-evidence";

const resume = {
  name: "Wecle",
  title: "Frontend Engineer",
  summary: "Builds AI products",
  skills: ["React", "TypeScript"],
  experience: [{ title: "Engineer", company: "Flash", period: "2024-now", bullets: ["Built Seconda"] }],
  projects: [{ name: "Seconda", description: "AI interview system", tags: ["Next.js"] }],
  education: [{ degree: "BSc", school: "Example University" }],
};

test("builds deterministic ordered evidence ids", () => {
  const first = indexResumeEvidence(resume, "raw resume");
  const second = indexResumeEvidence(resume, "raw resume");
  assert.deepEqual(first, second);
  assert.ok(first.records.some((record) => record.id.startsWith("project:0:")));
  assert.ok(first.records.some((record) => record.id.startsWith("experience:0:")));
});

test("loads bounded evidence and reports missing ids", () => {
  const index = indexResumeEvidence(resume, "raw resume");
  const id = index.records.find((record) => record.kind === "project")!.id;
  assert.equal(loadResumeEvidence(index, [id]).records[0].content.length <= 2000, true);
  assert.deepEqual(loadResumeEvidence(index, ["missing"]).missingIds, ["missing"]);
});

test("keeps raw resume content behind an explicit internal id", () => {
  const index = indexResumeEvidence(resume, "secret raw resume");
  assert.equal(index.directory.some((item) => item.id === "resume:raw"), true);
  assert.equal(index.records.some((item) => item.content.includes("secret raw resume")), false);
  assert.equal(loadResumeEvidence(index, ["resume:raw"]).records[0].content, "secret raw resume");
});
