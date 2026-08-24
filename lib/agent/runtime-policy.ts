function errorText(error: unknown) {
  if (error instanceof Error) return `${error.name} ${error.message}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "";
  }
}

export function isContextOverflowError(error: unknown) {
  return /(?:context.{0,24}(?:length|window|token|limit)|maximum context|too many tokens|prompt is too long)/i.test(errorText(error));
}
