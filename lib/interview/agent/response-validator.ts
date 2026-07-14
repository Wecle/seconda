export type ResponseValidationResult =
  | { ok: true }
  | {
    ok: false;
    code:
      | "MULTIPLE_QUESTIONS"
      | "FINISH_ASKS_QUESTION"
      | "FORMAL_SCORE"
      | "LANGUAGE_MISMATCH"
      | "UNAUTHORIZED_TERM"
      | "RESPONSE_TOO_LONG"
      | "PROTOCOL_CONTROL"
      | "SENSITIVE_CONTENT";
    message: string;
  };

type ResponseLanguage = "zh" | "en" | "es" | "de";

const formalScorePatterns = [
  /\bi\s+(?:would\s+)?(?:give|rate|score)\s+your\s+(?:answer|response|performance)\b/iu,
  /\byour\s+(?:overall\s+)?(?:score|rating|grade)\b/iu,
  /\b(?:answer|response|performance|logic|communication|understanding|depth|authenticity|reflection|candidate|interview)\b.{0,8}\b(?:score|rating|grade)\b/iu,
  /\btu\s+(?:puntuaci[oó]n|calificaci[oó]n|nota)\b/iu,
  /\b(?:respuesta|desempeño|entrevista)\b.{0,8}\b(?:puntuaci[oó]n|calificaci[oó]n|nota)\b/iu,
  /\b(?:deine|ihre)\s+(?:bewertung|punktzahl|note)\b/iu,
  /\b(?:antwort|leistung|interview)\b.{0,8}\b(?:bewertung|punktzahl|note)\b/iu,
  /(?:理解力|表达力|逻辑性|深度|真实性|反思力).{0,12}(?:10|[0-9])(?:\.\d+)?\s*(?:分(?!钟)|\/\s*10)/iu,
  /(?:你的|该回答的|本轮回答的|候选人的)(?:得分|评分|分数)\s*(?:是|为)?\s*(?:10|[0-9])(?:\.\d+)?(?:\s*分(?!钟)|(?=\s*(?:[。！？,.!?]|$)))/iu,
  /\bi\s+(?:would\s+)?(?:give|rate|score)\s+your\s+(?:answer|response|performance)\s+(?:an?\s+)?\d+(?:\.\d+)?\s*(?:points?)?\b/iu,
  /\byour\s+(?:overall\s+)?(?:score|rating|grade)\b.{0,12}\d+(?:\.\d+)?/iu,
  /\b(?:answer|response|performance|logic|communication|understanding|depth|authenticity|reflection|candidate|interview)\b.{0,8}\b(?:score|rating|grade)\b.{0,8}\d+(?:\.\d+)?/iu,
  /\d+(?:\.\d+)?\s*(?:out\s+of\s+10|\/\s*10)/iu,
  /\btu\s+(?:puntuaci[oó]n|calificaci[oó]n|nota)\b.{0,12}\d+(?:[.,]\d+)?/iu,
  /\b(?:respuesta|desempeño|entrevista)\b.{0,8}\b(?:puntuaci[oó]n|calificaci[oó]n|nota)\b.{0,8}\d+(?:[.,]\d+)?/iu,
  /\b(?:deine|ihre)\s+(?:bewertung|punktzahl|note)\b.{0,12}\d+(?:[.,]\d+)?/iu,
  /\b(?:antwort|leistung|interview)\b.{0,8}\b(?:bewertung|punktzahl|note)\b.{0,8}\d+(?:[.,]\d+)?/iu,
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten)\s+out\s+of\s+ten\b/iu,
  /\b(?:cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+de\s+diez\b/iu,
  /\b(?:null|eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn)\s+von\s+zehn\b/iu,
  /[零一二三四五六七八九十]\s*分.{0,6}(?:满分)?\s*十\s*分/iu,
];

const languageMarkers: Record<Exclude<ResponseLanguage, "zh">, ReadonlySet<string>> = {
  en: new Set([
    "based", "can", "could", "did", "discuss", "do", "does", "experience",
    "explain", "how", "on", "please", "resume", "the", "what", "when",
    "where", "which", "why", "would", "you", "your",
  ]),
  es: new Set([
    "aclarar", "c[oó]mo", "cu[aá]l", "cu[aá]ndo", "d[oó]nde", "elegiste",
    "el", "explica", "explicar", "la", "por", "proyecto", "puedes", "qu[eé]",
    "tu",
  ]),
  de: new Set([
    "das", "die", "erkl[aä]ren", "haben", "ihre", "k[oö]nnen", "projekt",
    "sie", "verbessert", "warum", "was", "welche", "wie",
  ]),
};

const safeTechnicalTerms = new Set([
  "ai", "api", "cpu", "css", "gpu", "html", "http", "https", "json", "rest",
  "sql", "tcp", "ui", "url", "ux", "xml",
]);

const protectedTechnologyTerms = [
  "aws", "azure", "docker", "gcp", "kubernetes", "mysql", "postgresql", "redis",
] as const;

const responseProtocolPatterns = [
  /\b(?:submit_interview_turn|responseText|proposalHash|coverageChanges)\b/u,
  /["'](?:assessment|decision)["']/u,
  /\b(?:assessment|decision)\b\s{0,8}(?::|=)/u,
  /<\/?(?:tool|system|assistant|developer)(?:\s|>)/iu,
  /```(?:json|sql)?\s{0,8}\{?\s{0,8}"?(?:assessment|decision)"?/iu,
];

const responseSensitivePatterns = [
  /[A-Za-z0-9][A-Za-z0-9._%+-]{29,}[A-Za-z0-9]/u,
  /[A-Za-z0-9._%+-]{1,30}@/u,
  /(?:\+?\d[\d\s()-]{8,}\d|\b1[3-9]\d{9}\b)/u,
  /\bapi[_ -]?key\b|\bsk-[A-Za-z0-9_-]{10,}/iu,
  /\bDATABASE_URL\b|postgres(?:ql)?:\/\//iu,
];

const MAX_RESPONSE_CHARACTERS = 2_000;

const sentenceInitialCommonWords = new Set([
  "based", "can", "could", "describe", "did", "do", "does", "explain", "how", "please",
  "tell", "thank", "that", "the", "this", "today", "we", "what", "when",
  "where", "which", "why", "would", "you", "your", "gracias", "puedes",
]);

export function validateFinalResponse(input: {
  action: "ask" | "clarify" | "finish";
  language: ResponseLanguage;
  text: string;
  allowedTerms: readonly string[];
}): ResponseValidationResult {
  const progress = validateResponse(input, false);
  if (!progress.ok) return progress;

  const questionCount = countQuestions(input.text);
  if (input.action === "finish" && (questionCount > 0 || startsWithQuestionIntent(input.text))) {
    return invalid("FINISH_ASKS_QUESTION", "结束语不得继续提问。");
  }
  if (input.action !== "finish" && (questionCount !== 1 || hasCompoundQuestion(input.text))) {
    return invalid("MULTIPLE_QUESTIONS", "每轮必须且只能提出一个问题。");
  }

  return { ok: true };
}

export function validateResponseProgress(input: {
  action: "ask" | "clarify" | "finish";
  language: ResponseLanguage;
  text: string;
  allowedTerms: readonly string[];
}): ResponseValidationResult {
  return validateResponse(input, true);
}

function validateResponse(input: {
  action: "ask" | "clarify" | "finish";
  language: ResponseLanguage;
  text: string;
  allowedTerms: readonly string[];
}, allowTrailingGroundingPrefix: boolean): ResponseValidationResult {
  if ([...input.text].length > MAX_RESPONSE_CHARACTERS) {
    return invalid("RESPONSE_TOO_LONG", "回复超过允许长度。");
  }
  if (responseProtocolPatterns.some((pattern) => pattern.test(input.text))) {
    return invalid("PROTOCOL_CONTROL", "回复不得包含内部协议控制内容。");
  }
  if (responseSensitivePatterns.some((pattern) => pattern.test(input.text))) {
    return invalid("SENSITIVE_CONTENT", "回复不得包含敏感或内部信息。");
  }
  if (containsFormalScore(input.text)) {
    return invalid("FORMAL_SCORE", "面试过程中的回复不得包含正式评分。");
  }
  if (hasEnoughLanguageSignal(input.text) && isLanguageMismatch(
    input.language,
    input.text,
    input.allowedTerms,
  )) {
    return invalid("LANGUAGE_MISMATCH", "回复语言与面试配置不一致。");
  }

  const questionCount = countQuestions(input.text);
  if (input.action === "finish" && (questionCount > 0 || startsWithQuestionIntent(input.text))) {
    return invalid("FINISH_ASKS_QUESTION", "结束语不得继续提问。");
  }
  if (input.action !== "finish" && (questionCount > 1 || hasCompoundQuestion(input.text))) {
    return invalid("MULTIPLE_QUESTIONS", "每轮必须且只能提出一个问题。");
  }

  const unauthorizedTerm = findUnauthorizedTerm(
    input.text,
    input.allowedTerms,
    input.language,
    allowTrailingGroundingPrefix,
  );
  if (unauthorizedTerm) {
    return invalid(
      "UNAUTHORIZED_TERM",
      `回复包含未经简历或上下文授权的内容：${unauthorizedTerm}`,
    );
  }
  return { ok: true };
}

function hasEnoughLanguageSignal(text: string) {
  const letters = text.match(/[\p{Script=Han}\p{Script=Latin}]/gu)?.length ?? 0;
  return letters >= 4;
}

function invalid(
  code: Exclude<ResponseValidationResult, { ok: true }>["code"],
  message: string,
): ResponseValidationResult {
  return { ok: false, code, message };
}

function containsFormalScore(text: string): boolean {
  return formalScorePatterns.some((pattern) => pattern.test(text));
}

function countQuestions(text: string): number {
  return text.match(/[?？]+/gu)?.length ?? 0;
}

function startsWithQuestionIntent(text: string): boolean {
  return /(?:^|[.!?。！？]\s*)(?:¿|can\b|could\b|do\b|does\b|did\b|how\b|what\b|when\b|where\b|which\b|why\b|would\b|(?:please\s+)?(?:tell|describe|explain|clarify|discuss|share)\b|你能|你可以|能否|是否|为什么|怎么|如何|请问|请(?:介绍|说明|讲讲|分享)|puedes\b|podr[ií]as\b|c[oó]mo\b|por\s+qu[eé]\b|(?:por\s+favor[,]?\s*)?(?:explica|aclare|describe|cu[eé]ntame)\b|k[oö]nnen\b|wie\b|warum\b|was\b|(?:bitte\s+)?(?:erkl[aä]ren|beschreiben|erz[aä]hlen)\b)/iu.test(text);
}

function hasCompoundQuestion(text: string): boolean {
  return [
    /\b(?:what|why|how|when|where|which)\b[^?？]{0,300}?(?:(?:,|;)\s*|(?:,|;)?\s+(?:and|then|also)\s+)\b(?:what|why|how|when|where|which)\b/iu,
    /(?:为什么|怎么|如何|什么|哪(?:个|些)?|何时|哪里)[^?？]{0,300}?(?:(?:，|,|；|;)\s*|(?:，|,|；|;)?\s*(?:以及|并且|然后|还要)[^?？]{0,8})(?:为什么|怎么|如何|什么|哪(?:个|些)?|何时|哪里)/u,
    /\b(?:qu[eé]|por\s+qu[eé]|c[oó]mo|cu[aá]ndo|d[oó]nde|cu[aá]l)\b[^?？]{0,300}?(?:(?:,|;)\s*|(?:,|;)?\s+(?:y|luego|adem[aá]s)\s+)\b(?:qu[eé]|por\s+qu[eé]|c[oó]mo|cu[aá]ndo|d[oó]nde|cu[aá]l)\b/iu,
    /\b(?:was|warum|wie|wann|wo|welche)\b[^?？]{0,300}?(?:(?:,|;)\s*|(?:,|;)?\s+(?:und|dann|außerdem)\s+)\b(?:was|warum|wie|wann|wo|welche)\b/iu,
  ].some((pattern) => pattern.test(text));
}

function isLanguageMismatch(
  language: ResponseLanguage,
  text: string,
  allowedTerms: readonly string[],
): boolean {
  const hanSpans = text.match(/\p{Script=Han}+/gu) ?? [];
  if (language === "zh") {
    const hanCharacterCount = hanSpans.join("").length;
    const latinCharacterCount = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
    if (
      hanCharacterCount === 0
      && latinCharacterCount > 0
      && isAllowedLatinPrefix(text, allowedTerms)
    ) return false;
    return hanCharacterCount === 0
      || (hanCharacterCount < 4 && latinCharacterCount > hanCharacterCount * 2);
  }
  if (hanSpans.some((span) => !isAllowedHanSpan(span, allowedTerms))) return true;

  const scores = scoreLatinLanguages(text.replace(/\p{Script=Han}+/gu, " "));
  const expectedScore = scores[language];
  const competingScores = Object.entries(scores)
    .filter(([candidate]) => candidate !== language)
    .map(([, score]) => score);
  const strongestCompetitor = Math.max(...competingScores);

  return (strongestCompetitor >= 2 && strongestCompetitor > expectedScore)
    || (expectedScore === 0 && strongestCompetitor === 1);
}

function isAllowedLatinPrefix(text: string, allowedTerms: readonly string[]) {
  const normalized = normalizeGroundingTerm(text).replace(/[^\p{L}\p{N}+.#/-]+/gu, " ").trim();
  if (!normalized) return false;
  return allowedTerms.some((term) => {
    const allowed = normalizeGroundingTerm(term)
      .replace(/[^\p{L}\p{N}+.#/-]+/gu, " ")
      .trim();
    return allowed.startsWith(normalized);
  });
}

function scoreLatinLanguages(text: string): Record<Exclude<ResponseLanguage, "zh">, number> {
  const normalizedWords = text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .match(/\p{L}+/gu) ?? [];

  const scores = { en: 0, es: 0, de: 0 };
  for (const word of normalizedWords) {
    for (const language of Object.keys(languageMarkers) as Array<keyof typeof languageMarkers>) {
      if ([...languageMarkers[language]].some((marker) => new RegExp(`^${marker}$`, "u").test(word))) {
        scores[language] += 1;
      }
    }
  }
  if (/[¿¡ñáéíóúü]/iu.test(text)) scores.es += 2;
  if (/[äöüß]/iu.test(text)) scores.de += 2;
  return scores;
}

function findUnauthorizedTerm(
  text: string,
  allowedTerms: readonly string[],
  language: ResponseLanguage,
  allowTrailingGroundingPrefix: boolean,
): string | null {
  const normalizedAllowedTerms = allowedTerms.map(normalizeGroundingTerm);
  const allowedNumbers = collectAllowedNumbers(allowedTerms);
  const allowedNumberSet = new Set(allowedNumbers);
  const normalizedText = text.normalize("NFKC");
  const numbers = normalizedText.matchAll(/\d+(?:[.,]\d+)?/gu);
  for (const match of numbers) {
    const number = match[0];
    if (!allowedNumberSet.has(normalizeNumber(number))) {
      const trailingPrefix = trailingNumberPrefix(normalizedText, match.index, number);
      if (
        allowTrailingGroundingPrefix
        && trailingPrefix
        && isStrictPrefixOfAllowedNumber(trailingPrefix, allowedNumbers)
      ) continue;
      return number;
    }
  }

  if (language !== "zh") {
    const hanSpans = text.match(/\p{Script=Han}+/gu) ?? [];
    for (const span of hanSpans) {
      if (!isAllowedHanSpan(span, allowedTerms)) return span;
    }
  }

  for (const technology of protectedTechnologyTerms) {
    const match = text.match(new RegExp(`\\b${technology}\\b`, "iu"));
    if (match && !isAllowedNamedTerm(match[0], allowedTerms, normalizedAllowedTerms)) {
      return match[0];
    }
  }

  const candidates = [...text.matchAll(/\b[\p{Lu}][\p{L}\p{N}_+.#/-]*\b/gu)];
  for (const candidate of candidates) {
    const term = candidate[0];
    const normalizedTerm = normalizeGroundingTerm(term);
    if (normalizedTerm.length < 2 || safeTechnicalTerms.has(normalizedTerm)) continue;
    if (isLanguageMarker(normalizedTerm)) continue;
    if (isAllowedNamedTerm(term, allowedTerms, normalizedAllowedTerms)) continue;
    if (language === "de" && !isStrongEntitySignal(term)) continue;

    const isAtSentenceStart = isSentenceStart(text, candidate.index ?? 0);
    if (isAtSentenceStart && sentenceInitialCommonWords.has(normalizedTerm)) continue;
    if (
      allowTrailingGroundingPrefix
      && isTrailingToken(text, candidate.index ?? 0, term)
      && isStrictPrefixOfAllowedNamedToken(term, allowedTerms)
    ) continue;
    return term;
  }

  return null;
}

function isAllowedHanSpan(span: string, allowedTerms: readonly string[]): boolean {
  const allowedHanSpans = allowedTerms.flatMap(
    (term) => term.normalize("NFKC").match(/\p{Script=Han}+/gu) ?? [],
  );
  const normalizedSpan = span.normalize("NFKC");
  const genericSuffixes = [
    "", "公司", "团队", "项目", "平台", "系统", "业务", "的", "的公司", "的团队",
    "的项目", "的平台", "的系统", "的业务",
  ];
  return allowedHanSpans.some((allowed) =>
    genericSuffixes.some((suffix) => normalizedSpan === `${allowed}${suffix}`)
  );
}

function isStrongEntitySignal(term: string): boolean {
  const letters = term.match(/\p{L}/gu)?.join("") ?? "";
  return letters.length > 1 && (
    letters === letters.toLocaleUpperCase()
    || /\p{Ll}.*\p{Lu}/u.test(letters)
  );
}

function normalizeNumber(value: string): string {
  return value.normalize("NFKC").replace(",", ".");
}

function isTrailingToken(text: string, index: number, token: string): boolean {
  return index + token.length === text.length;
}

function collectAllowedNumbers(allowedTerms: readonly string[]): string[] {
  return allowedTerms.flatMap((allowedTerm) => (
    [...allowedTerm.normalize("NFKC").matchAll(
      /(?:^|[^\p{L}\p{N}])(\d+(?:[.,]\d+)?)/gu,
    )].map((match) => normalizeNumber(match[1]))
  ));
}

function trailingNumberPrefix(
  text: string,
  index: number,
  number: string,
): string | null {
  const end = index + number.length;
  if (end === text.length) return number;
  const remainder = text.slice(end);
  return remainder === "." || remainder === "," ? `${number}${remainder}` : null;
}

function isStrictPrefixOfAllowedNumber(
  number: string,
  allowedNumbers: readonly string[],
): boolean {
  const normalizedNumber = normalizeNumber(number);
  return allowedNumbers.some((allowedNumber) => (
    allowedNumber.length > normalizedNumber.length
    && allowedNumber.startsWith(normalizedNumber)
  ));
}

function isStrictPrefixOfAllowedNamedToken(
  term: string,
  allowedTerms: readonly string[],
): boolean {
  const escapedTerm = term.normalize("NFKC").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const strictPrefixPattern = new RegExp(
    `(?:^|[^\\p{Script=Latin}\\p{N}])${escapedTerm}[\\p{Script=Latin}\\p{N}_+.#/-]+(?![\\p{Script=Latin}\\p{N}])`,
    "iu",
  );
  return allowedTerms.some((allowedTerm) => strictPrefixPattern.test(allowedTerm.normalize("NFKC")));
}

function isAllowedNamedTerm(
  term: string,
  allowedTerms: readonly string[],
  normalizedAllowedTerms: readonly string[],
): boolean {
  const normalizedTerm = normalizeGroundingTerm(term);
  if (normalizedAllowedTerms.includes(normalizedTerm)) return true;

  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const boundaryPattern = new RegExp(
    `(?:^|[^\\p{Script=Latin}\\p{N}])${escapedTerm}(?![\\p{Script=Latin}\\p{N}])`,
    "iu",
  );
  return allowedTerms.some((allowed) => boundaryPattern.test(allowed.normalize("NFKC")));
}

function isLanguageMarker(term: string): boolean {
  return Object.values(languageMarkers).some((markers) =>
    [...markers].some((marker) => new RegExp(`^${marker}$`, "u").test(term))
  );
}

function normalizeGroundingTerm(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function isSentenceStart(text: string, index: number): boolean {
  const prefix = text.slice(0, index);
  return prefix.trim().length === 0 || /[.!?。！？]\s*$/u.test(prefix);
}
