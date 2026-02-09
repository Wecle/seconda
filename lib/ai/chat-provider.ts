import { createOpenAI } from "@ai-sdk/openai";

const baseURL = process.env.BASE_URL?.trim();
const apiKey = process.env.OPENAI_API_KEY?.trim();

export const baseModel =
  process.env.BASE_MODEL?.trim() || "gpt-4o-mini";

const normalizedBaseURL = (() => {
  if (!baseURL) return undefined;

  const trimmed = baseURL.replace(/\/+$/, "");
  const hasPath = /^https?:\/\/[^/]+\/.+/.test(trimmed);

  if (hasPath) return trimmed;
  return `${trimmed}/v1`;
})();

const chatProvider = createOpenAI({
  ...(normalizedBaseURL ? { baseURL: normalizedBaseURL } : {}),
  ...(apiKey ? { apiKey } : {}),
});

export const chatLanguageModel = chatProvider.chat(baseModel);
