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
    instructions: "先从证据目录选择 ID；需要原文时调用 get_resume_evidence。问题中引用的经历必须能追溯到已加载的证据 ID。",
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
    name: "answer-evaluation",
    version: "1",
    description: "按既定六维评分模型评估最新回答。",
    instructions: "使用 record_answer_evaluation 写入理解力、表达力、逻辑性、深度、真实性、反思力及综合分，并提供优点、改进、建议和深挖材料。",
    toolNames: ["get_interview_history", "record_answer_evaluation"],
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
    : ["resume-grounding", "coverage-planning", "answer-evaluation"];
  const active = names.map((name) => catalog.get(name)!);
  return {
    skills: active,
    toolNames: new Set(active.flatMap((skill) => skill.toolNames as InterviewToolName[])),
  };
}

export function renderSkillInstructions(active: readonly InterviewSkill[]) {
  return active.map((skill) => `<skill name="${skill.name}" version="${skill.version}">\n${skill.instructions}\n</skill>`).join("\n");
}
