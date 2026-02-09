import { generateObject } from "ai";
import { chatLanguageModel } from "@/lib/ai/chat-provider";
import { parsedResumeSchema } from "./types";

function buildResumeParseInput(text: string): string {
  const normalized = text.trim();
  if (normalized.length <= 12000) {
    return normalized;
  }

  const head = normalized.slice(0, 7000);
  const tail = normalized.slice(-5000);
  return `${head}\n\n[...中间内容省略...]\n\n${tail}`;
}

export async function parseResumeWithAI(extractedText: string) {
  const { object } = await generateObject({
    model: chatLanguageModel,
    schema: parsedResumeSchema,
    system: `你是专业的简历分析与面试专家。
只允许基于简历原文进行解析，不得虚构或补充不存在的信息。
请将简历解析为结构化数据。缺失内容保持为空数组或空字符串。
summary 字段必须返回；如果简历中没有明确个人简介，可以总结一下简历内容，实在没有也必须返回 summary: ""。
projects 字段必须提取“全部项目”，不要只挑选代表性项目。
若简历里有多个项目（个人项目、公司项目、平台项目），都要逐条输出，保持原文顺序，不要合并。`,
    prompt: `请解析以下简历内容：\n\n${buildResumeParseInput(extractedText)}`,
  });

  return object;
}
