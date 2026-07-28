import assert from "node:assert/strict";
import test from "node:test";
import { serializeParsedResume } from "./canonical-text";

test("serializes every populated resume section in stable order", () => {
  const resume = {
    name: "Ada",
    title: "Engineer",
    summary: "Builds reliable systems",
    contact: {
      website: "https://ada.example.com",
      phone: "+1 555 0100",
      email: "ada@example.com",
      linkedin: "https://linkedin.com/in/ada",
      location: "London",
    },
    skills: ["TypeScript"],
    experience: [{
      title: "Engineer",
      company: "Example",
      period: "2024-present",
      bullets: ["Reduced latency"],
    }],
    education: [{ degree: "BSc", school: "Example University", period: "2020-2024" }],
    projects: [{ name: "Compiler", description: "A real project", tags: ["TypeScript"] }],
  };
  const text = serializeParsedResume(resume);
  const reorderedContactText = serializeParsedResume({
    ...resume,
    contact: {
      location: "London",
      linkedin: "https://linkedin.com/in/ada",
      email: "ada@example.com",
      phone: "+1 555 0100",
      website: "https://ada.example.com",
    },
  });

  assert.equal(text, reorderedContactText);
  assert.match(text, /Ada[\s\S]*Engineer[\s\S]*Builds reliable systems/);
  assert.match(
    text,
    /Contact\nemail: ada@example\.com\nphone: \+1 555 0100\nlocation: London\nlinkedin: https:\/\/linkedin\.com\/in\/ada\nwebsite: https:\/\/ada\.example\.com/,
  );
  assert.match(text, /Skills\nTypeScript/);
  assert.match(text, /Experience[\s\S]*Reduced latency/);
  assert.match(text, /Education\nBSc \| Example University \| 2020-2024/);
  assert.match(text, /Projects\nCompiler\nA real project\nTags: TypeScript/);

  const sectionOffsets = [
    text.indexOf("Ada\nEngineer"),
    text.indexOf("Summary\n"),
    text.indexOf("Contact\n"),
    text.indexOf("Skills\n"),
    text.indexOf("Experience\n"),
    text.indexOf("Education\n"),
    text.indexOf("Projects\n"),
  ];
  assert.deepEqual(sectionOffsets, [...sectionOffsets].sort((left, right) => left - right));
  assert.ok(sectionOffsets.every((offset) => offset >= 0));
});
