import { generateObject } from "ai";
import { openaiLanguageModel } from "@/lib/ai/openai";
import { parsedResumeSchema } from "./types";

export async function parseResumeWithAI(extractedText: string) {
  const { object } = await generateObject({
    model: openaiLanguageModel,
    schema: parsedResumeSchema,
    system: `你是专业的简历分析与面试专家。
只允许基于简历原文进行解析，不得虚构或补充不存在的信息。
请将简历解析为结构化数据。缺失内容保持为空数组或空字符串。`,
    prompt: `请解析以下简历内容：\n\n${extractedText.slice(0, 8000)}`,
  });

  return object;
}
