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
    instructions: "先从证据目录选择 ID；需要原文时调用 get_resume_evidence。候选人可见评价和问题中的确定性事实必须逐项写入 claims，并关联已加载的证据 ID 或 get_interview_history 返回的 answer:消息ID。不得补全人数、年限、技术栈、职责或成果；无法确认时改成询问句。",
    toolNames: ["get_resume_evidence", "get_interview_history"],
  },
  {
    name: "coverage-planning",
    version: "1",
    description: "根据覆盖度、回答质量和信息增益决定追问、换题或结束。",
    instructions: "提问前读取或使用当前覆盖度；每次回答后更新对应主题。同类最多三题，全局最多二十轮，信息增益不足时结束。",
    toolNames: ["get_coverage_state", "update_coverage", "ask_interview_question", "finish_interview"],
  },
  {
    name: "answer-planning",
    version: "1",
    description: "根据已提交的轻量评估规划下一步面试行动。",
    instructions: "系统已经完成最新回答的轻量质量判断。读取历史和覆盖度后，只选择一个追问、一个新主题或结束；不得生成或写入正式分数。追问时先用1到3句评价已确认的回答内容，指出一个优势、缺口或含糊点，再自然引出且只引出一个问题。评价必须有 claims 来源，不做人格判断。",
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
  return {
    skills: active,
    toolNames: new Set(active.flatMap((skill) => skill.toolNames as InterviewToolName[])),
  };
}

export function renderSkillInstructions(active: readonly InterviewSkill[]) {
  return active.map((skill) => `<skill name="${skill.name}" version="${skill.version}">\n${skill.instructions}\n</skill>`).join("\n");
}
