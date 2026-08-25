import { createStaticSkillProvider, type StaticSkillDefinition } from "@/lib/agent/skills/static-provider";

export const INTERVIEW_SKILL_NAMES = [
  "behavioral-interview",
  "frontend-interview",
  "backend-interview",
  "system-design-interview",
  "product-interview",
  "leadership-interview",
  "resume-deep-dive",
  "star-method",
  "project-authenticity",
  "follow-up-strategy",
] as const;

const interviewSkills: readonly StaticSkillDefinition[] = [
  {
    name: "behavioral-interview",
    description: "Design evidence-based behavioral questions about decisions, collaboration, conflict, and reflection.",
    version: "1.0.0",
    instructions: "Ask for one concrete past situation. Probe the candidate's own actions, constraints, alternatives, measurable outcome, and reflection. Do not reward generic principles without a specific example. Keep the question appropriate to the configured level and submit only through the interview action tool.",
  },
  {
    name: "frontend-interview",
    description: "Probe frontend architecture, browser behavior, performance, accessibility, and engineering tradeoffs.",
    version: "1.0.0",
    instructions: "Anchor the question in a resume project or declared frontend technology. Ask about data flow, rendering boundaries, browser constraints, performance or accessibility tradeoffs, and how the candidate verified the result. Prefer reasoning from first principles over trivia.",
  },
  {
    name: "backend-interview",
    description: "Probe API, data, reliability, concurrency, observability, and backend design decisions.",
    version: "1.0.0",
    instructions: "Anchor the question in backend evidence from the resume. Probe API boundaries, persistence model, concurrency and failure handling, security, observability, and operational tradeoffs. Ask for concrete implementation details and verification evidence.",
  },
  {
    name: "system-design-interview",
    description: "Structure level-appropriate system design questions and evaluate explicit tradeoffs.",
    version: "1.0.0",
    instructions: "Start from requirements and scale assumptions relevant to the target role. Probe boundaries, data model, critical flows, consistency, failure recovery, security, and observability. Require explicit tradeoffs instead of a catalog of technologies, and keep scope achievable for the configured level.",
  },
  {
    name: "product-interview",
    description: "Explore product judgment, user value, prioritization, experiments, and outcome measurement.",
    version: "1.0.0",
    instructions: "Ask the candidate to connect an engineering decision to a user or business outcome. Probe problem framing, prioritization, stakeholder constraints, success metrics, experiment design, and what changed after learning from results.",
  },
  {
    name: "leadership-interview",
    description: "Explore technical leadership, influence, delegation, conflict, and team-level outcomes.",
    version: "1.0.0",
    instructions: "Use only when the target level or resume evidence supports leadership scope. Ask for a concrete situation involving influence without relying on title. Probe alignment, conflict, delegation, decision quality, team outcome, and reflection without assuming formal management responsibility.",
  },
  {
    name: "resume-deep-dive",
    description: "Turn resume evidence into a focused opening or main question without inventing facts.",
    version: "1.0.0",
    instructions: "Select one high-signal resume claim that matches the target role. Cite only supplied resumeEvidenceIds. Ask the candidate to explain their personal contribution, architecture or method, key constraint, decision tradeoff, outcome, and lesson learned. Never infer facts absent from the frozen snapshot.",
  },
  {
    name: "star-method",
    description: "Use STAR as an answer-clarity method without coaching the candidate toward a preferred answer.",
    version: "1.0.0",
    instructions: "When a behavioral answer is vague, identify which of Situation, Task, Action, or Result is missing. Ask one concise follow-up about the highest-value missing element. Do not teach or reveal an ideal answer during the interview.",
  },
  {
    name: "project-authenticity",
    description: "Test whether claimed project experience is concrete, internally consistent, and personally owned.",
    version: "1.0.0",
    instructions: "Probe details a real contributor should know: initial state, personal ownership, constraints, a rejected alternative, implementation or debugging detail, evidence of outcome, and what they would change. Treat inconsistencies as points to clarify, not proof of dishonesty.",
  },
  {
    name: "follow-up-strategy",
    description: "Choose a single high-value follow-up only when the prior answer has a material evidence gap.",
    version: "1.0.0",
    instructions: "Follow up only on a material gap that prevents judging the current topic. Prioritize missing personal action, technical mechanism, tradeoff, failure handling, or measurable result. Ask one focused question, avoid repeating wording, and switch to a new main topic when the answer is already sufficiently specific.",
  },
];

export function createInterviewSkillProvider() {
  return createStaticSkillProvider("interview-built-ins", interviewSkills);
}
