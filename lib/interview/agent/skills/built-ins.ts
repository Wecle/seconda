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
  "challenge-protocol",
  "differentiation-mining",
  "time-constraint-probe",
  "pushback-handling",
  "interviewer-archetype",
] as const;

const interviewSkills: readonly StaticSkillDefinition[] = [
  {
    name: "behavioral-interview",
    description: "Design evidence-based behavioral questions about decisions, collaboration, conflict, and reflection.",
    version: "1.0.0",
    instructions: "Ask for one concrete past situation. Probe ONE specific aspect of the candidate's actions, constraints, or reflection. Ask a single focused question without compound sub-questions or 1) 2) 3) lists. Do not reward generic principles without a specific example. Keep the question appropriate to the configured level.",
  },
  {
    name: "frontend-interview",
    description: "Probe frontend architecture, browser behavior, performance, accessibility, and engineering tradeoffs.",
    version: "1.0.0",
    instructions: "Anchor the question in a resume project or declared frontend technology. Pick ONE specific technical dimension (such as data flow, rendering boundaries, or a browser performance tradeoff) to probe deeply. Ask exactly one focused question without numbering sub-questions.",
  },
  {
    name: "backend-interview",
    description: "Probe API, data, reliability, concurrency, observability, and backend design decisions.",
    version: "1.0.0",
    instructions: "Anchor the question in backend evidence from the resume. Pick ONE concrete architectural or reliability decision (such as persistence model, concurrency control, or failure recovery) to probe. Ask exactly one focused question; do not combine multiple topics into a multi-part list.",
  },
  {
    name: "system-design-interview",
    description: "Structure level-appropriate system design questions and evaluate explicit tradeoffs.",
    version: "1.0.0",
    instructions: "Start from requirements and scale assumptions relevant to the target role. Pick ONE critical design aspect (such as boundary definition, consistency tradeoff, or failure recovery) to explore first. Pose a single focused question instead of a catalog or numbered list of sub-questions.",
  },
  {
    name: "product-interview",
    description: "Explore product judgment, user value, prioritization, experiments, and outcome measurement.",
    version: "1.0.0",
    instructions: "Ask the candidate to connect an engineering decision to a user or business outcome. Probe ONE concrete angle (problem framing, prioritization, or experiment outcome). Pose a single direct question without sub-parts.",
  },
  {
    name: "leadership-interview",
    description: "Explore technical leadership, influence, delegation, conflict, and team-level outcomes.",
    version: "1.0.0",
    instructions: "Use only when the target level or resume evidence supports leadership scope. Ask for a concrete situation involving influence without relying on title. Focus on ONE element (such as alignment, conflict resolution, or decision tradeoff) in a single concise question.",
  },
  {
    name: "resume-deep-dive",
    description: "Turn resume evidence into a focused opening or main question without inventing facts.",
    version: "1.0.0",
    instructions: "Select one high-signal resume claim that matches the target role. Cite only supplied resumeEvidenceIds. Pick ONE highest-value aspect (personal contribution boundary, core architecture, key constraint, or tradeoff) to ask. Focus on a single concrete entry point; never ask multiple sub-questions (no 1) 2) 3) lists) in a single turn. Never infer facts absent from the frozen snapshot.",
  },
  {
    name: "star-method",
    description: "Use STAR as an answer-clarity method without coaching the candidate toward a preferred answer.",
    version: "1.0.0",
    instructions: "When a behavioral answer is vague, identify which of Situation, Task, Action, or Result is missing. Ask one concise follow-up about the single highest-value missing element. Do not teach or reveal an ideal answer during the interview.",
  },
  {
    name: "project-authenticity",
    description: "Test whether claimed project experience is concrete, internally consistent, and personally owned.",
    version: "1.0.0",
    instructions: "Test whether claimed project experience is concrete, internally consistent, and personally owned. Pick ONE concrete detail a real contributor should know (initial state, personal ownership boundary, a rejected alternative, or debugging war story). Probe it with a single focused question without splitting into sub-questions.",
  },
  {
    name: "follow-up-strategy",
    description: "Choose a single high-value follow-up only when the prior answer has a material evidence gap.",
    version: "1.0.0",
    instructions: "Follow up only on a material gap that prevents judging the current topic. Prioritize ONE missing element (personal action, technical mechanism, tradeoff, or failure handling). Ask exactly one focused conversational question; never ask compound or multi-part questions (no 1) 2) 3) lists). Switch to a new main topic when the answer is already sufficiently specific.",
  },
  {
    name: "challenge-protocol",
    description: "Deploy 5-lens red-team challenge (Assumption Audit, Blind Spot Scan, Pre-Mortem, Devil's Advocate, Strengthening Path) against senior or overly-rehearsed answers.",
    version: "1.0.0",
    instructions: "Deploy ONE red-team challenge angle (Assumption Audit, Blind Spot Scan, Pre-Mortem, Devil's Advocate, or Strengthening Path) against senior or overly-rehearsed answers. Pose exactly one constructive challenge question to test defense and refinement; avoid combining multiple challenge questions.",
  },
  {
    name: "differentiation-mining",
    description: "Probe for earned secrets and spiky points of view that separate authentic senior practitioners from generic template answers.",
    version: "1.0.0",
    instructions: "Look beyond standard STAR frameworks. Ask about ONE non-obvious lesson or counter-intuitive tradeoff that contradicts textbook best practices. Keep the inquiry focused on a single prompt without sub-question lists.",
  },
  {
    name: "time-constraint-probe",
    description: "Simulate time-pressured executive communication by requiring a 30s-60s bottom-line summary or elevator pitch.",
    version: "1.0.0",
    instructions: "When a candidate's answer is rambling or background-heavy, intervene with an executive time constraint. Ask for a single 30-to-60-second bottom-line takeaway (core metric or fundamental engineering/business lesson) in one concise sentence.",
  },
  {
    name: "pushback-handling",
    description: "Challenge candidate claims with constructive skepticism to evaluate composure, rigor, and openness to counter-evidence.",
    version: "1.0.0",
    instructions: "Identify a single key claim or architectural choice and challenge it directly with constructive skepticism. Pose one clear challenge to evaluate composure and reasoning without piling on additional questions.",
  },
  {
    name: "interviewer-archetype",
    description: "Maintain high persona fidelity according to designated interviewer archetype (Skeptic, Friendly Ally, Time-Pressured Exec, Deep Architect).",
    version: "1.0.0",
    instructions: "Adopt and maintain the configured archetype style in single-point conversational probes. Skeptics focus on proof and attribution; Friendly Allies encourage open sharing while noting unguarded flaws; Time-Pressured Execs interrupt verbosity and demand bottom lines; Deep Architects trace technical mechanics down to the kernel/protocol layer. Always enforce single-question discipline.",
  },
];

export function createInterviewSkillProvider() {
  return createStaticSkillProvider("interview-built-ins", interviewSkills);
}
