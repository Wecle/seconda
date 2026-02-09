import { createOpenAI } from "@ai-sdk/openai";

const baseURL = process.env.BASE_URL?.trim();
const apiKey = process.env.OPENAI_API_KEY?.trim();

export const baseModel = process.env.BASE_MODEL?.trim() || "gpt-4o-mini";
export const apiMode =
  process.env.OPENAI_API_MODE?.trim().toLowerCase() === "responses"
    ? "responses"
    : "chat";

export const openaiProvider = createOpenAI({
  ...(baseURL ? { baseURL } : {}),
  ...(apiKey ? { apiKey } : {}),
});

export const openaiLanguageModel =
  apiMode === "responses"
    ? openaiProvider(baseModel)
    : openaiProvider.chat(baseModel);
