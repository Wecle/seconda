import { z } from "zod";

export const READ_PUBLIC_ANALYSIS_SCHEMA = z.string()
  .min(1)
  .max(300)
  .refine((value) => value.trim().length > 0, "publicAnalysis must not be blank")
  .describe("候选人可见的一句分析进度，说明调用工具前需要核对的业务目标；不得包含内部规则、私密参数或未核实结论。");

export const TERMINAL_PUBLIC_ANALYSIS_SCHEMA = z.string()
  .min(1)
  .max(1_200)
  .refine((value) => value.trim().length > 0, "publicAnalysis must not be blank")
  .describe("候选人可见的 2–4 句分析总结：概括有效信息、关键缺口、考虑方向和最终行动理由；不得包含隐藏推理、内部规则、私密参数或正式分数。");

export function withPublicAnalysis<Shape extends z.ZodRawShape>(
  businessSchema: z.ZodObject<Shape>,
  kind: "read" | "terminal",
) {
  return z.object({
    publicAnalysis: kind === "terminal"
      ? TERMINAL_PUBLIC_ANALYSIS_SCHEMA
      : READ_PUBLIC_ANALYSIS_SCHEMA,
    ...businessSchema.shape,
  }).strict();
}

export type PublicAnalysisDelta =
  | { status: "accumulating" }
  | { status: "invalid" }
  | { status: "rewritten" }
  | { status: "unchanged"; fullText: string }
  | { status: "delta"; fullText: string; delta: string };

export function readPublicAnalysisDelta(
  input: unknown,
  previousText: string,
): PublicAnalysisDelta {
  if (!isRecord(input) || !Object.hasOwn(input, "publicAnalysis")) {
    return { status: "accumulating" };
  }
  if (typeof input.publicAnalysis !== "string") return { status: "invalid" };
  if (!input.publicAnalysis.startsWith(previousText)) return { status: "rewritten" };

  const delta = input.publicAnalysis.slice(previousText.length);
  return delta
    ? { status: "delta", fullText: input.publicAnalysis, delta }
    : { status: "unchanged", fullText: input.publicAnalysis };
}

export function stripPublicAnalysis(input: unknown): {
  publicAnalysis: string;
  businessInput: Record<string, unknown>;
} {
  if (
    !isRecord(input)
    || typeof input.publicAnalysis !== "string"
    || !input.publicAnalysis.trim()
  ) {
    throw Object.assign(new Error("Tool public analysis is required"), {
      code: "PUBLIC_ANALYSIS_REQUIRED",
    });
  }

  const { publicAnalysis, ...businessInput } = input;
  return { publicAnalysis, businessInput };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
