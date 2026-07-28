import assert from "node:assert/strict";
import test from "node:test";
import { serializeParsedResume } from "./canonical-text";

test("serializes every populated resume section in stable order", () => {
  const text = serializeParsedResume({
    name: "Ada",
    title: "Engineer",
    summary: "Builds reliable systems",
    contact: { email: "ada@example.com" },
    skills: ["TypeScript"],
    experience: [{
      title: "Engineer",
      company: "Example",
      period: "2024-present",
      bullets: ["Reduced latency"],
    }],
    education: [{ degree: "BSc", school: "Example University", period: "2020-2024" }],
    projects: [{ name: "Compiler", description: "A real project", tags: ["TypeScript"] }],
  });
  assert.match(text, /Ada[\s\S]*Engineer[\s\S]*Builds reliable systems/);
  assert.match(text, /ada@example\.com/);
  assert.match(text, /Reduced latency/);
  assert.match(text, /Compiler/);
  assert.equal(text, serializeParsedResume({
    name: "Ada",
    title: "Engineer",
    summary: "Builds reliable systems",
    contact: { email: "ada@example.com" },
    skills: ["TypeScript"],
    experience: [{
      title: "Engineer",
      company: "Example",
      period: "2024-present",
      bullets: ["Reduced latency"],
    }],
    education: [{ degree: "BSc", school: "Example University", period: "2020-2024" }],
    projects: [{ name: "Compiler", description: "A real project", tags: ["TypeScript"] }],
  }));
});
