export interface DeepDiveData {
  coreConcepts: {
    title?: string;
    subtitle?: string;
    items: { name: string; description: string }[];
  };
  pitfalls: string[];
  modelAnswer: {
    approach?: string;
    steps: { title: string; description: string }[];
  };
}

const EMPTY_DEEP_DIVE: DeepDiveData = {
  coreConcepts: { items: [] },
  pitfalls: [],
  modelAnswer: { steps: [] },
};

export function normalizeDeepDive(raw: unknown): DeepDiveData {
  if (!raw || typeof raw !== "object") {
    return EMPTY_DEEP_DIVE;
  }

  const data = raw as Record<string, unknown>;

  if ("pitfalls" in data && "modelAnswer" in data) {
    return data as unknown as DeepDiveData;
  }

  const coreConcepts: DeepDiveData["coreConcepts"] = { items: [] };
  if (Array.isArray(data.coreConcepts)) {
    coreConcepts.items = data.coreConcepts.map(
      (c: Record<string, string>) => ({
        name: c.title ?? c.name ?? "",
        description: c.description ?? "",
      })
    );
  } else if (
    data.coreConcepts &&
    typeof data.coreConcepts === "object" &&
    "items" in (data.coreConcepts as Record<string, unknown>)
  ) {
    coreConcepts.items = (
      (data.coreConcepts as Record<string, unknown>).items as Array<
        Record<string, string>
      >
    ).map((c) => ({
      name: c.name ?? c.title ?? "",
      description: c.description ?? "",
    }));
  }

  const pitfalls: string[] = Array.isArray(data.commonPitfalls)
    ? data.commonPitfalls
    : Array.isArray(data.pitfalls)
      ? data.pitfalls
      : [];

  const steps: DeepDiveData["modelAnswer"]["steps"] = [];
  if (Array.isArray(data.modelAnswerSteps)) {
    for (const s of data.modelAnswerSteps as Record<string, string>[]) {
      steps.push({
        title: s.step ?? s.title ?? "",
        description: s.detail ?? s.description ?? "",
      });
    }
  } else if (
    data.modelAnswer &&
    typeof data.modelAnswer === "object" &&
    "steps" in (data.modelAnswer as Record<string, unknown>)
  ) {
    const ma = data.modelAnswer as Record<string, unknown>;
    if (Array.isArray(ma.steps)) {
      for (const s of ma.steps as Record<string, string>[]) {
        steps.push({
          title: s.title ?? "",
          description: s.description ?? "",
        });
      }
    }
  }

  return {
    coreConcepts,
    pitfalls,
    modelAnswer: {
      approach:
        data.modelAnswer &&
        typeof data.modelAnswer === "object" &&
        "approach" in (data.modelAnswer as Record<string, unknown>)
          ? String((data.modelAnswer as Record<string, string>).approach)
          : undefined,
      steps,
    },
  };
}
