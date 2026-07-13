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
    instructions: "优先使用 Prompt 中已注入的最近消息、answer:消息ID、覆盖度和证据目录；这些数据存在时不得重复调用 get_interview_history 或 get_coverage_state。只有需要证据目录未包含的简历原文细节时才调用 get_resume_evidence，并且只能使用目录中出现的稳定 ID。候选人可见评价和问题中的确定性事实必须逐项写入 claims；无法确认时改成询问句。sourceIds 只能放在 claims 中，绝不能出现在 acknowledgement 或 question。不得补全人数、年限、技术栈、职责或成果。",
    toolNames: ["get_resume_evidence", "get_interview_history"],
  },
  {
    name: "coverage-planning",
    version: "1",
    description: "根据覆盖度、回答质量和信息增益决定追问、换题或结束。",
    instructions: "优先使用已注入的覆盖度；仅在 Prompt 未提供覆盖度时调用 get_coverage_state。每次回答后更新对应主题。同类最多三题，全局最多二十轮，信息增益不足时只能提出结束建议，最终由应用策略校验。开场岗位明确时在 ask_interview_question 中提交带来源的 inferred targetRole；候选人确认方向后提交 confirmed targetRole；方向不明确时使用 clarify 且不虚构岗位。",
    toolNames: ["get_coverage_state", "update_coverage", "ask_interview_question", "finish_interview"],
  },
  {
    name: "answer-planning",
    version: "1",
    description: "根据已提交的轻量评估规划下一步面试行动。",
    instructions: "系统已经完成最新回答的轻量质量判断，并已注入最近消息和覆盖度；不得重复调用读取工具。只选择一个追问、一个新主题或结束；不得生成或写入正式分数。追问时先用1到3句评价已确认的回答内容，指出一个优势、缺口或含糊点，再自然引出且只引出一个问题。评价必须有 claims 来源，不做人格判断。",
    toolNames: ["get_interview_history", "get_coverage_state", "update_coverage", "ask_interview_question", "finish_interview"],
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
