import { z } from "zod";
import { interviewToolNames, type InterviewToolName } from "./tool-registry";

const skillSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  version: z.string().min(1).max(50),
  description: z.string().min(1).max(300),
  instructions: z.string().min(1).max(4_000),
  toolNames: z.array(z.string().min(1)).min(1),
}).strict();

export type InterviewSkill = z.infer<typeof skillSchema>;

const skills: InterviewSkill[] = [
  {
    name: "resume-grounding",
    version: "1",
    description: "基于稳定简历证据提问，禁止补全或虚构经历。",
    instructions: "优先使用 Prompt 中已注入的最近消息、answer:消息ID、覆盖度和证据目录；这些数据存在时不得重复调用 get_interview_history 或 get_coverage_state。只有需要证据目录未包含的简历原文细节时才调用 get_resume_evidence，并且只能使用目录中出现的稳定 ID。终结提案的 evidenceIds 和 coverageChanges 只能引用已提供的稳定证据 ID；无法确认的事实必须改成询问句。不得补全人数、年限、技术栈、职责或成果。",
    toolNames: ["get_resume_evidence", "get_interview_history"],
  },
  {
    name: "coverage-planning",
    version: "1",
    description: "根据覆盖度、回答质量和信息增益决定追问、换题或结束。",
    instructions: "优先使用已注入的覆盖度；仅在 Prompt 未提供覆盖度时调用 get_coverage_state。每次回答后把轻量评估、覆盖度变化与下一行动合并到唯一的 submit_interview_turn 终结提案。同类最多三题，全局最多二十轮，结束建议最终由应用策略校验。开场方向不明确时使用 clarify 且不虚构岗位。",
    toolNames: ["get_coverage_state", "submit_interview_turn"],
  },
  {
    name: "answer-planning",
    version: "1",
    description: "根据已提交的轻量评估规划下一步面试行动。",
    instructions: "基于最新回答和已注入覆盖度，在 submit_interview_turn 中同时提交无分数轻量评估、覆盖度变化和一个追问、新主题或结束行动。当前回答分类的 coverageChanges 状态必须与 assessment 一致：followUpNeeded=true 使用 partial，followUpNeeded=false 使用 sufficient；该分类达到第 3 题时使用 exhausted。通常只提交当前回答分类的变化，不得改变其他分类聚合状态。不得生成正式分数。responseText 必须围绕本轮唯一的结构化核心考察意图，可以包含必要的回答提示，但不得切换到无关主题；评价只复述已确认内容，不做人格判断。",
    toolNames: ["get_interview_history", "get_coverage_state", "submit_interview_turn"],
  },
];

export function createSkillCatalog(definitions: unknown[], availableTools: ReadonlySet<string>) {
  const catalog = new Map<string, InterviewSkill>();
  for (const value of definitions) {
    const skill = skillSchema.parse(value);
    if (catalog.has(skill.name)) throw new Error(`Duplicate skill: ${skill.name}`);
    for (const toolName of skill.toolNames) {
      if (!availableTools.has(toolName)) throw new Error(`Skill ${skill.name} references unknown tool: ${toolName}`);
    }
    catalog.set(skill.name, skill);
  }
  return catalog;
}

const catalog = createSkillCatalog(skills, new Set(interviewToolNames));

export function resolveRunSkills(mode: "opening" | "answer") {
  const names = mode === "opening"
    ? ["resume-grounding", "coverage-planning"]
    : ["resume-grounding", "coverage-planning", "answer-planning"];
  const active = names.map((name) => catalog.get(name)!);
  const toolNames = new Set(active.flatMap((skill) => skill.toolNames as InterviewToolName[]));
  if (mode === "opening") toolNames.delete("get_interview_history");
  return { skills: active, toolNames };
}

export function renderSkillInstructions(active: readonly InterviewSkill[]) {
  return active.map((skill) => `<skill name="${skill.name}" version="${skill.version}">\n${skill.instructions}\n</skill>`).join("\n");
}
