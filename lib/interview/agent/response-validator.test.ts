import assert from "node:assert/strict";
import test from "node:test";

import {
  validateConfiguredLanguage,
  validateFinalResponse,
  validateResponseProgress,
} from "./response-validator";

test("validates configured language for public analysis", () => {
  assert.deepEqual(validateConfiguredLanguage({
    language: "zh",
    text: "Based on the answer, I will inspect the project evidence before choosing a follow-up.",
    allowedTerms: [],
  }), {
    ok: false,
    code: "LANGUAGE_MISMATCH",
    message: "回复语言与面试配置不一致。",
  });
});

test("rejects unsafe response progress without enforcing question completeness", () => {
  assert.deepEqual(validateResponseProgress({
    action: "ask",
    language: "zh",
    text: "你提到了 30 秒回退机制。",
    allowedTerms: ["30 秒", "回退机制"],
  }), { ok: true });
  for (const input of [
    { text: "你的逻辑性是 8 分。", allowedTerms: ["8"] },
    { text: "你提到了 60 秒回退机制。", allowedTerms: ["30 秒", "回退机制"] },
    { text: "responseText: 请继续", allowedTerms: [] },
  ]) {
    assert.equal(validateResponseProgress({
      action: "ask",
      language: "zh",
      text: input.text,
      allowedTerms: input.allowedTerms,
    }).ok, false);
  }
  assert.equal(validateResponseProgress({
    action: "finish",
    language: "zh",
    text: "面试结束，还有问题吗？",
    allowedTerms: [],
  }).ok, false);
  assert.equal(validateResponseProgress({
    action: "ask",
    language: "zh",
    text: "长".repeat(2_001),
    allowedTerms: [],
  }).ok, false);
});

test("allows multiple question clauses and declarative prompts for one structured action", () => {
  for (const input of [
    { language: "zh" as const, text: "你会怎样设计这条监控链路？采集怎么做？上报和分析为什么这样取舍？" },
    { language: "en" as const, text: "What failed, and how did you recover? How did you verify the result?" },
    { language: "es" as const, text: "Explica el diseño, cómo lo validaste y qué cambiarías." },
    { language: "de" as const, text: "Beschreiben Sie den Entwurf und wie Sie das Ergebnis geprüft haben." },
    { language: "zh" as const, text: "请围绕监控链路说明采集、上报和分析的设计" },
  ]) {
    assert.deepEqual(validateFinalResponse({
      action: "ask",
      language: input.language,
      text: input.text,
      allowedTerms: [],
    }), { ok: true }, input.text);
  }
});

test("defers only trailing grounded token prefixes during response progress", () => {
  assert.deepEqual(validateResponseProgress({
    action: "ask",
    language: "zh",
    text: "你提到了 React 和 Vu",
    allowedTerms: ["React", "Vue"],
  }), { ok: true });
  assert.deepEqual(validateResponseProgress({
    action: "ask",
    language: "zh",
    text: "恢复时间是 3",
    allowedTerms: ["30 秒"],
  }), { ok: true });

  for (const input of [
    { text: "你提到了 React 和 Foo", allowedTerms: ["React", "Vue"] },
    { text: "恢复时间是 60", allowedTerms: ["30 秒"] },
    { text: "你提到了 React 和 Vu，", allowedTerms: ["React", "Vue"] },
    { text: "恢复时间是 3 秒", allowedTerms: ["30 秒"] },
    { text: "你提到了 React 和 Vu", allowedTerms: ["ReactAndVue"] },
    { text: "恢复时间是 3", allowedTerms: ["metric30"] },
  ]) {
    const result = validateResponseProgress({
      action: "ask",
      language: "zh",
      text: input.text,
      allowedTerms: input.allowedTerms,
    });
    assert.equal(result.ok, false, input.text);
    if (!result.ok) assert.equal(result.code, "UNAUTHORIZED_TERM", input.text);
  }
});

test("keeps final grounding strict for incomplete token prefixes", () => {
  for (const input of [
    { text: "你提到了 React 和 Vu", allowedTerms: ["React", "Vue"] },
    { text: "恢复时间是 3", allowedTerms: ["30 秒"] },
  ]) {
    const result = validateFinalResponse({
      action: "ask",
      language: "zh",
      text: input.text,
      allowedTerms: input.allowedTerms,
    });
    assert.equal(result.ok, false, input.text);
    if (!result.ok) assert.equal(result.code, "UNAUTHORIZED_TERM", input.text);
  }
});

test("handles compact units, decimal chunks, and normalized numeric grounding", () => {
  for (const input of [
    { text: "恢复时间是 3", allowedTerms: ["30秒"] },
    { text: "误差是 3.", allowedTerms: ["3.5%"] },
    { text: "误差是 3,", allowedTerms: ["3,5%"] },
    { text: "恢复时间是 3", allowedTerms: ["３０ 秒"] },
  ]) {
    assert.deepEqual(validateResponseProgress({
      action: "ask",
      language: "zh",
      text: input.text,
      allowedTerms: input.allowedTerms,
    }), { ok: true }, input.text);
  }

  assert.deepEqual(validateResponseProgress({
    action: "ask",
    language: "zh",
    text: "误差是 3.5%",
    allowedTerms: ["3.5%"],
  }), { ok: true });
  assert.deepEqual(validateFinalResponse({
    action: "ask",
    language: "zh",
    text: "误差是 3.5%，原因是什么？",
    allowedTerms: ["3.5%"],
  }), { ok: true });
  assert.deepEqual(validateFinalResponse({
    action: "ask",
    language: "zh",
    text: "恢复时间是 30 秒，原因是什么？",
    allowedTerms: ["３０ 秒"],
  }), { ok: true });

  for (const input of [
    { text: "恢复时间是 3", allowedTerms: ["metric30"] },
    { text: "metric3", allowedTerms: ["metric30"] },
    { text: "误差是 3.", allowedTerms: ["30%"] },
    { text: "误差是 3,", allowedTerms: ["30%"] },
  ]) {
    const result = validateResponseProgress({
      action: "ask",
      language: "zh",
      text: input.text,
      allowedTerms: input.allowedTerms,
    });
    assert.equal(result.ok, false, input.text);
    if (!result.ok) assert.equal(result.code, "UNAUTHORIZED_TERM", input.text);
  }

  for (const input of [
    { text: "metric30", allowedTerms: ["metric30"] },
    { text: "v1.2", allowedTerms: ["v1.2"] },
    { text: "Vue3", allowedTerms: ["Vue3"] },
    { text: "恢复耗时30秒", allowedTerms: ["恢复耗时30秒"] },
  ]) {
    assert.deepEqual(validateResponseProgress({
      action: "ask",
      language: "zh",
      text: input.text,
      allowedTerms: input.allowedTerms,
    }), { ok: true }, input.text);
  }
  assert.deepEqual(validateFinalResponse({
    action: "ask",
    language: "zh",
    text: "你使用 Vue3 完成了升级，主要难点是什么？",
    allowedTerms: ["Vue3"],
  }), { ok: true });
  assert.deepEqual(validateFinalResponse({
    action: "ask",
    language: "zh",
    text: "恢复耗时30秒，主要瓶颈是什么？",
    allowedTerms: ["恢复耗时30秒"],
  }), { ok: true });
});

test("accepts grounded final text and rejects unsafe final text", () => {
  assert.deepEqual(validateFinalResponse({
    action: "ask",
    language: "zh",
    text: "你提到了 30 秒回退机制，能说明自动降级的触发条件吗？",
    allowedTerms: ["30 秒", "回退机制", "自动降级"],
  }), { ok: true });
  assert.deepEqual(validateFinalResponse({
    action: "ask",
    language: "zh",
    text: "为什么？如何处理？",
    allowedTerms: [],
  }), { ok: true });
  assert.equal(validateFinalResponse({
    action: "ask",
    language: "zh",
    text: "你的逻辑性是 8 分。为什么？",
    allowedTerms: [],
  }).ok, false);
  assert.equal(validateFinalResponse({
    action: "finish",
    language: "zh",
    text: "结束了，还有问题吗？",
    allowedTerms: [],
  }).ok, false);
});

test("does not treat allowed resume metrics as formal scores", () => {
  assert.deepEqual(validateFinalResponse({
    action: "ask",
    language: "zh",
    text: "你写到故障恢复耗时从 90 秒降到 30 秒，能解释关键改动吗？",
    allowedTerms: ["90 秒", "30 秒", "故障恢复"],
  }), { ok: true });
  assert.deepEqual(validateFinalResponse({
    action: "ask",
    language: "zh",
    text: "你写到部署耗时为 30 分钟，主要瓶颈是什么？",
    allowedTerms: ["30 分钟", "部署耗时"],
  }), { ok: true });
});

test("accepts a declarative finish and rejects interrogative finishes", () => {
  assert.deepEqual(validateFinalResponse({
    action: "finish",
    language: "zh",
    text: "今天的模拟面试到这里结束，感谢你的回答。",
    allowedTerms: [],
  }), { ok: true });
  assert.deepEqual(validateFinalResponse({
    action: "finish",
    language: "en",
    text: "Thank you for your answers. That concludes today's interview.",
    allowedTerms: [],
  }), { ok: true });
  const result = validateFinalResponse({
    action: "finish",
    language: "en",
    text: "That concludes the interview. Do you have any questions?",
    allowedTerms: [],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "FINISH_ASKS_QUESTION");
  assert.equal(validateFinalResponse({
    action: "finish",
    language: "en",
    text: "Could you add anything else",
    allowedTerms: [],
  }).ok, false);
});

test("accepts supported-language question punctuation", () => {
  assert.deepEqual(validateFinalResponse({
    action: "clarify",
    language: "es",
    text: "¿Puedes aclarar qué puesto estás buscando?",
    allowedTerms: [],
  }), { ok: true });
  assert.deepEqual(validateFinalResponse({
    action: "ask",
    language: "de",
    text: "Wie haben Sie die Verfügbarkeit verbessert?",
    allowedTerms: [],
  }), { ok: true });
});

test("rejects clear language mismatches", () => {
  const result = validateFinalResponse({
    action: "ask",
    language: "zh",
    text: "Can you explain the rollback mechanism?",
    allowedTerms: [],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "LANGUAGE_MISMATCH");

  assert.equal(validateFinalResponse({
    action: "ask",
    language: "de",
    text: "¿Puedes explicar el proyecto?",
    allowedTerms: [],
  }).ok, false);
  assert.equal(validateFinalResponse({
    action: "ask",
    language: "zh",
    text: "Can you explain the rollback 的 mechanism?",
    allowedTerms: ["rollback", "mechanism"],
  }).ok, false);
  assert.equal(validateFinalResponse({
    action: "ask",
    language: "de",
    text: "Please discuss your experience?",
    allowedTerms: [],
  }).ok, false);
});

test("allows only grounded Han spans in Latin-language responses", () => {
  assert.equal(validateFinalResponse({
    action: "ask",
    language: "en",
    text: "How did your work at 阿里云 affect latency?",
    allowedTerms: [],
  }).ok, false);
  assert.deepEqual(validateFinalResponse({
    action: "ask",
    language: "en",
    text: "How did your work at 字节跳动 affect latency?",
    allowedTerms: ["字节跳动"],
  }), { ok: true });
  assert.deepEqual(validateFinalResponse({
    action: "ask",
    language: "en",
    text: "How did 字节跳动公司 affect your approach?",
    allowedTerms: ["字节跳动"],
  }), { ok: true });
  assert.deepEqual(validateFinalResponse({
    action: "ask",
    language: "en",
    text: "What was 字节跳动的 role in the project?",
    allowedTerms: ["字节跳动"],
  }), { ok: true });
  assert.equal(validateFinalResponse({
    action: "ask",
    language: "en",
    text: "How did 阿里云公司 affect your approach?",
    allowedTerms: ["字节跳动"],
  }).ok, false);
});

test("rejects unauthorized numbers and named entities", () => {
  const numberResult = validateFinalResponse({
    action: "ask",
    language: "zh",
    text: "这个机制是否会在 60 秒后触发？",
    allowedTerms: ["30 秒"],
  });
  assert.equal(numberResult.ok, false);
  if (!numberResult.ok) assert.equal(numberResult.code, "UNAUTHORIZED_TERM");

  assert.equal(validateFinalResponse({
    action: "ask",
    language: "zh",
    text: "这个机制是否会在 3 秒后触发？",
    allowedTerms: ["30 秒"],
  }).ok, false);

  const entityResult = validateFinalResponse({
    action: "ask",
    language: "en",
    text: "How did you deploy the service to Kubernetes?",
    allowedTerms: ["service"],
  });
  assert.equal(entityResult.ok, false);
  if (!entityResult.ok) assert.equal(entityResult.code, "UNAUTHORIZED_TERM");

  assert.equal(validateFinalResponse({
    action: "ask",
    language: "en",
    text: "How did you operate kubernetes in production?",
    allowedTerms: [],
  }).ok, false);
  assert.deepEqual(validateFinalResponse({
    action: "ask",
    language: "en",
    text: "How did you operate kubernetes in production?",
    allowedTerms: ["Kubernetes"],
  }), { ok: true });
});

test("allows grounded technical terms and avoids capitalization false positives", () => {
  assert.deepEqual(validateFinalResponse({
    action: "ask",
    language: "en",
    text: "How did Apollo and the API coordinate rollback?",
    allowedTerms: ["Apollo", "API", "rollback"],
  }), { ok: true });
  assert.deepEqual(validateFinalResponse({
    action: "ask",
    language: "en",
    text: "Based on your resume, what did you improve?",
    allowedTerms: [],
  }), { ok: true });
  assert.deepEqual(validateFinalResponse({
    action: "ask",
    language: "de",
    text: "Wie haben Sie die Dynamische Konfiguration im Projekt abgesichert?",
    allowedTerms: [],
  }), { ok: true });
});

test("still grounds strong entity signals in German without flagging ordinary nouns", () => {
  const result = validateFinalResponse({
    action: "ask",
    language: "de",
    text: "Wie wurde AWS für die Dynamische Konfiguration eingesetzt?",
    allowedTerms: [],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "UNAUTHORIZED_TERM");

  assert.deepEqual(validateFinalResponse({
    action: "ask",
    language: "de",
    text: "Wie wurde AWS für die Dynamische Konfiguration eingesetzt?",
    allowedTerms: ["AWS"],
  }), { ok: true });
});

test("rejects formal score wording across supported languages", () => {
  for (const input of [
    { language: "zh" as const, text: "你的表达力得分是 7 分。为什么采用这个结构？" },
    { language: "en" as const, text: "Your logic score is 8 out of 10. Why this design?" },
    { language: "es" as const, text: "Tu puntuación es 8 de 10. ¿Por qué elegiste este diseño?" },
    { language: "de" as const, text: "Deine Bewertung ist 8 von 10. Warum dieses Design?" },
  ]) {
    const result = validateFinalResponse({
      action: "ask",
      language: input.language,
      text: input.text,
      allowedTerms: [],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORMAL_SCORE");
  }

  const wordScore = validateFinalResponse({
    action: "ask",
    language: "en",
    text: "Your answer is nine out of ten. What would you change?",
    allowedTerms: [],
  });
  assert.equal(wordScore.ok, false);
  if (!wordScore.ok) assert.equal(wordScore.code, "FORMAL_SCORE");
  const directAssessment = validateFinalResponse({
    action: "ask",
    language: "en",
    text: "I give your answer 8 points. Why did you choose this design?",
    allowedTerms: ["8"],
  });
  assert.equal(directAssessment.ok, false);
  if (!directAssessment.ok) assert.equal(directAssessment.code, "FORMAL_SCORE");
  const directChineseAssessment = validateFinalResponse({
    action: "ask",
    language: "zh",
    text: "你的评分是 8 分。为什么采用这个结构？",
    allowedTerms: ["8"],
  });
  assert.equal(directChineseAssessment.ok, false);
  if (!directChineseAssessment.ok) assert.equal(directChineseAssessment.code, "FORMAL_SCORE");
});

test("does not confuse a grounded domain score with formal assessment", () => {
  assert.deepEqual(validateFinalResponse({
    action: "ask",
    language: "en",
    text: "The risk score fell by 30 percent; what caused the change?",
    allowedTerms: ["risk score", "30 percent"],
  }), { ok: true });
  assert.deepEqual(validateFinalResponse({
    action: "ask",
    language: "zh",
    text: "你的风险评分从 8 降到 3，原因是什么？",
    allowedTerms: ["风险评分", "8", "3"],
  }), { ok: true });
  assert.deepEqual(validateFinalResponse({
    action: "ask",
    language: "en",
    text: "Your risk score fell by 30 percent; what caused the change?",
    allowedTerms: ["risk score", "30 percent"],
  }), { ok: true });
  assert.deepEqual(validateFinalResponse({
    action: "ask",
    language: "zh",
    text: "风险评分从 8 降到 3，原因是什么？",
    allowedTerms: ["风险评分", "8", "3"],
  }), { ok: true });
});

test("rejects candidate prompts when the structured action is finish", () => {
  for (const input of [
    { language: "en" as const, text: "Please tell me more about the project." },
    { language: "en" as const, text: "Thank you. Please tell me more about the project." },
    { language: "zh" as const, text: "面试结束。请介绍更多。" },
  ]) {
    const result = validateFinalResponse({
      action: "finish",
      language: input.language,
      text: input.text,
      allowedTerms: [],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FINISH_ASKS_QUESTION");
  }
});

test("rejects public PII and internal credentials", () => {
  for (const text of [
    "请联系 candidate@example.com 后说明回退机制？",
    "请使用 DATABASE_URL=postgresql://secret 后说明回退机制？",
    "请使用 api_key=sk-secret123456 后说明回退机制？",
  ]) {
    const result = validateResponseProgress({
      action: "ask",
      language: "zh",
      text,
      allowedTerms: ["回退机制"],
    });
    assert.equal(result.ok, false, text);
    assert.equal(!result.ok && result.code, "SENSITIVE_CONTENT", text);
  }
});
