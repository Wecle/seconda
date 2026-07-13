export const scoreDimensionNames = [
  "understanding",
  "expression",
  "logic",
  "depth",
  "authenticity",
  "reflection",
] as const;

export type DimensionScores = Record<(typeof scoreDimensionNames)[number], number>;

export function roundToOneDecimal(value: number) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

export function calculateQuestionOverall(scores: DimensionScores) {
  return roundToOneDecimal(
    scoreDimensionNames.reduce((sum, dimension) => sum + scores[dimension], 0)
      / scoreDimensionNames.length,
  );
}

export function aggregateInterviewScores(scores: Array<DimensionScores & { overall: number }>) {
  if (scores.length === 0) {
    return {
      overallScore: 0,
      dimensions: Object.fromEntries(scoreDimensionNames.map((name) => [name, 0])) as DimensionScores,
    };
  }
  const dimensions = Object.fromEntries(scoreDimensionNames.map((dimension) => [
    dimension,
    roundToOneDecimal(scores.reduce((sum, score) => sum + score[dimension], 0) / scores.length),
  ])) as DimensionScores;
  return {
    overallScore: Math.round(
      (scores.reduce((sum, score) => sum + score.overall, 0) / scores.length) * 10,
    ),
    dimensions,
  };
}
