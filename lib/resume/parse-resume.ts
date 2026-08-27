import { generateStructured } from "@/lib/ai/generate-structured";
import { parsedResumeSchema } from "./types";
import type { AITaskTelemetryContext } from "@/lib/ai/telemetry/types";

function buildResumeParseInput(text: string): string {
  const normalized = text.trim();
  if (normalized.length <= 100_000) {
    return normalized;
  }

  const head = normalized.slice(0, 60_000);
  const tail = normalized.slice(-40_000);
  return `${head}\n\n[...中间内容省略...]\n\n${tail}`;
}

export async function parseResumeWithAI(
  extractedText: string,
  telemetry?: AITaskTelemetryContext,
) {
  return generateStructured({
    task: "resume.parse",
    schema: parsedResumeSchema,
    system: `你是专业的简历结构化解析与面试专家。
只允许基于简历原文进行解析，不得虚构或补充不存在的信息。
请将简历解析为结构化数据。缺失内容保持为空数组或空字符串。

【提取核心规则】：
1. 完整保真（Verbatim & Comprehensive）：
   - 严禁自行合并、缩写或概括原文中的职责与难点描述。
   - 原文中的关键技术栈、业务场景、量化数据指标（如“降低60%”、“200ms”）必须 100% 完整保留。

2. 工作经历（experience）与项目经历（projects）的自适应归属规则：
   - 模式一（技术/项目分离型）：若【工作经历】仅为简短公司条目（如“公司 | 职位 | 时间”），而详细职责/难点写在【项目经历】中，请在 experience 中提取公司概况（bullets 可为空或简述），并在 projects 中完整提取每一个独立项目（包括个人项目、公司业务项目、平台项目），把项目下的每条难点/职责放入 bullets 列表中，description 填写项目一句话概述或背景。
   - 模式二（业务/公司主线型）：若简历没有独立项目经历，所有工作内容均写在公司下方，请将所有职责与业绩完整提取至对应 experience.bullets 中，projects 保持为空数组。
   - 模式三（混合型）：若公司经历和项目经历均有详细描述，两者均需完整提取，不得丢失任何一方。

3. projects 提取规则：
   - projects 字段必须提取“全部项目”，不得只挑选代表性项目。
   - 保持原文顺序，逐条输出，不要合并。
   - 每个项目的 bullets 数组必须完整收录该项目的所有职责、技术难点与量化成果。

4. 个人简介与字段兜底：
   - summary 字段必须返回；如果简历中没有明确个人简介，可以简明总结一下简历整体背景，实在没有则返回 summary: ""。
   - 技能列表（skills）提取简历中出现的所有技术栈、工具与专业技能。`,
    prompt: `请解析以下简历内容：\n\n${buildResumeParseInput(extractedText)}`,
    telemetry,
  });
}
