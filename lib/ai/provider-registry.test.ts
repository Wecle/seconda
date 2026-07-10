import assert from "node:assert/strict";
import test from "node:test";
import { generateText } from "ai";
import { z } from "zod";
import {
  applyStructuredOutputInstructions,
  createProviderOutput,
  createProviderModel,
} from "./provider-registry";

const schema = z.object({ value: z.string() });

async function requestFor(model: string, credentialTier: "fast" | "quality", apiKey: string) {
  let url = "";
  let authorization = "";
  let body: Record<string, unknown> = {};
  const provider = createProviderModel({
    model,
    credentialTier,
    apiKey,
    fetch: async (input, init) => {
      url = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: "fixture",
          object: "chat.completion",
          created: 0,
          model: body.model,
          choices: [{ index: 0, message: { role: "assistant", content: '{"value":"ok"}' }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const result = await generateText({
    model: provider.model,
    system: "Return JSON.",
    prompt: "fixture",
    maxRetries: 0,
    output: createProviderOutput(schema, provider.metadata),
  });

  return { provider, url, authorization, body, output: result.output };
}

test("DeepSeek uses its direct endpoint, stripped model id, JSON object, disabled thinking, and fast key", async () => {
  const result = await requestFor("deepseek/deepseek-chat", "fast", "fast-sentinel");
  assert.equal(result.url, "https://api.deepseek.com/chat/completions");
  assert.equal(result.authorization, "Bearer fast-sentinel");
  assert.equal(result.body.model, "deepseek-chat");
  assert.deepEqual(result.body.response_format, { type: "json_object" });
  assert.deepEqual(result.body.thinking, { type: "disabled" });
  assert.equal(result.provider.metadata.structuredOutput, "json-object");
  assert.equal(result.provider.metadata.jsonInstruction, "请只返回合法 JSON 对象。");
  assert.deepEqual(result.output, { value: "ok" });
});

test("智谱中国区 uses its mandated endpoint, stripped model id, and selected quality key", async () => {
  const result = await requestFor("zhipu/glm-5.1", "quality", "quality-sentinel");
  assert.equal(result.url, "https://open.bigmodel.cn/api/paas/v4/chat/completions");
  assert.equal(result.authorization, "Bearer quality-sentinel");
  assert.equal(result.body.model, "glm-5.1");
  assert.deepEqual(result.body.response_format, { type: "json_object" });
  assert.equal("thinking" in result.body, false);
  assert.equal(result.provider.metadata.structuredOutput, "json-object");
  assert.deepEqual(result.output, { value: "ok" });
});

test("OpenAI uses only the selected tier key instead of ambient OPENAI_API_KEY", async () => {
  const saved = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "poisoned-ambient-key";
  try {
    const result = await requestFor("openai/gpt-5-mini", "fast", "fast-sentinel");
    assert.equal(result.url, "https://api.openai.com/v1/chat/completions");
    assert.equal(result.authorization, "Bearer fast-sentinel");
    assert.equal(result.body.model, "gpt-5-mini");
    assert.equal(result.authorization.includes("poisoned"), false);
  } finally {
    if (saved === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved;
  }
});

test("rejects unsupported provider models before any request", () => {
  assert.throws(
    () => createProviderModel({ model: "unknown/model", credentialTier: "fast", apiKey: "key" }),
    /supported provider prefix/,
  );
});

test("adds a static JSON Schema instruction only for the DeepSeek JSON Object adapter", () => {
  const deepseek = createProviderModel({
    model: "deepseek/deepseek-v4-flash",
    credentialTier: "fast",
    apiKey: "fixture",
  });
  const openai = createProviderModel({
    model: "openai/gpt-5-mini",
    credentialTier: "fast",
    apiKey: "fixture",
  });
  const system = "Business system instruction";

  const deepseekSystem = applyStructuredOutputInstructions(system, schema, deepseek.metadata);
  assert.match(deepseekSystem, /Business system instruction/);
  assert.match(deepseekSystem, /JSON Schema/);
  assert.match(deepseekSystem, /"value"/);
  assert.equal(applyStructuredOutputInstructions(system, schema, openai.metadata), system);
});
