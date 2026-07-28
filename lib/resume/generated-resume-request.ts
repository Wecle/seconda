import {
  generatedResumeRequestSchema,
  type GeneratedResumeInput,
} from "./generation-contract";

export type GeneratedResumeRequestBodyResult =
  | { success: true; data: GeneratedResumeInput }
  | { success: false; details?: unknown };

export async function parseGeneratedResumeRequestBody(
  request: Pick<Request, "json">,
): Promise<GeneratedResumeRequestBodyResult> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { success: false };
  }

  const parsed = generatedResumeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return { success: false, details: parsed.error.flatten() };
  }
  return { success: true, data: parsed.data };
}
