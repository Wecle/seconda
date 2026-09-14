import assert from "node:assert/strict";
import test from "node:test";
import { projectInterviewRunModelMessage } from "./projections/model";
import { buildInterviewSystemPrompt } from "./agent/prompt";

test("projectInterviewRunModelMessage embeds untrusted JD data when present", () => {
  const message = projectInterviewRunModelMessage({
    trigger: "opening",
    targetRole: "全栈工程师",
    targetLevel: "Senior",
    interviewType: "mixed",
    language: "zh",
    persona: "standard",
    preference: "",
    preferenceTags: [],
    targetRoundCount: 6,
    answeredRoundCount: 0,
    remainingRounds: 6,
    canonicalResume: "简历正文",
    resumeEvidence: {},
    jobDescription: {
      title: "资深全栈工程师",
      company: "Seconda",
      mustHaveSkills: ["Node.js", "React"],
      canonicalText: "JD 正文",
    },
    currentQuestion: null,
    currentAnswer: null,
    history: [],
    coveredTopics: [],
  });

  const content = typeof message.content === "string" ? message.content : "";
  assert.match(content, /<untrusted_interview_data>/);
  assert.match(content, /资深全栈工程师/);
});

test("projectInterviewRunModelMessage works cleanly when JD is absent", () => {
  const message = projectInterviewRunModelMessage({
    trigger: "opening",
    targetRole: "全栈工程师",
    targetLevel: "Senior",
    interviewType: "mixed",
    language: "zh",
    persona: "standard",
    preference: "",
    preferenceTags: [],
    targetRoundCount: 6,
    answeredRoundCount: 0,
    remainingRounds: 6,
    canonicalResume: "简历正文",
    resumeEvidence: {},
    jobDescription: null,
    currentQuestion: null,
    currentAnswer: null,
    history: [],
    coveredTopics: [],
  });

  const content = typeof message.content === "string" ? message.content : "";
  assert.match(content, /<untrusted_interview_data>/);
  assert.doesNotMatch(content, /资深全栈工程师/);
});

test("buildInterviewSystemPrompt includes match & gap rules", () => {
  const prompt = buildInterviewSystemPrompt({
    language: "zh",
    persona: "standard",
    interviewType: "mixed",
    targetLevel: "Senior",
  });
  assert.match(prompt, /胜任力契合与差距摸底/);
  assert.match(prompt, /单一、具体的切入点/);
});
