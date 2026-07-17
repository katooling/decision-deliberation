import {
  BenchmarkArmSchema,
  LIVE_BENCHMARK_DISCLAIMER,
  PairedBenchmarkSuiteSchema,
  type BenchmarkArm,
  type BenchmarkComparison,
  type MeanBenchmarkScore,
  type PairedArmResult,
  type PairedBenchmarkReport,
  type PairedBenchmarkSuite,
  type PairedCaseResult,
} from "./paired-contract.js";

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function meanScore(
  reviews: PairedBenchmarkSuite["cases"][number]["reviews"],
  artifactId: string,
): MeanBenchmarkScore | null {
  const matching = reviews.filter((review) => review.artifactId === artifactId);
  if (matching.length === 0) return null;
  const average = (key: keyof (typeof matching)[number]["scores"]): number =>
    round(matching.reduce((sum, review) => sum + review.scores[key], 0) / matching.length);
  const decisionQuality = average("decisionQuality");
  const coverage = average("coverage");
  const traceability = average("traceability");
  return {
    decisionQuality,
    coverage,
    traceability,
    composite: round((decisionQuality + coverage + traceability) / 3),
    reviewCount: matching.length,
  };
}

function compareToTreatment(
  artifact: PairedArmResult,
  treatment: PairedArmResult,
  tieTolerance: number,
): BenchmarkComparison {
  if (artifact.arm === "decision_tree") return "reference";
  if (artifact.status !== "complete" || treatment.status !== "complete") return "unscored";
  if (artifact.constraintViolations.length > 0 || treatment.constraintViolations.length > 0) {
    return "unscored";
  }
  if (artifact.meanScore === null || treatment.meanScore === null) return "unscored";
  const delta = artifact.meanScore.composite - treatment.meanScore.composite;
  if (Math.abs(delta) <= tieTolerance) return "tie";
  return delta > 0 ? "win" : "loss";
}

export function runPairedBenchmark(input: unknown): PairedBenchmarkReport {
  const suite = PairedBenchmarkSuiteSchema.parse(input);
  const cases = suite.cases.map((benchmarkCase): PairedCaseResult => {
    const artifacts = Object.fromEntries(
      benchmarkCase.artifacts.map((artifact) => [artifact.arm, artifact]),
    ) as Record<BenchmarkArm, (typeof benchmarkCase.artifacts)[number]>;
    const treatment = artifacts.decision_tree;
    const treatmentTokens = treatment.usage.inputTokens + treatment.usage.outputTokens;
    const preliminaryArms = Object.fromEntries(
      BenchmarkArmSchema.options.map((arm) => {
        const artifact = artifacts[arm];
        const totalTokens = artifact.usage.inputTokens + artifact.usage.outputTokens;
        const tokenRatioToTreatment = treatmentTokens === 0
          ? arm === "decision_tree" ? 1 : null
          : round(totalTokens / treatmentTokens);
        const computeMatchedToTreatment = artifact.status !== "missing" && treatment.status !== "missing" &&
          (arm === "decision_tree" || (
          tokenRatioToTreatment !== null &&
          Math.abs(tokenRatioToTreatment - 1) <= suite.computeTolerance
          ));
        const result: PairedArmResult = {
          artifactId: artifact.artifactId,
          arm,
          status: artifact.status,
          calls: artifact.calls,
          totalTokens,
          latencyMs: artifact.usage.latencyMs,
          costUsd: artifact.usage.costUsd ?? null,
          constraintViolations: [...artifact.constraintViolations],
          meanScore: meanScore(benchmarkCase.reviews, artifact.artifactId),
          tokenRatioToTreatment,
          computeMatchedToTreatment,
          comparisonToTreatment: arm === "decision_tree" ? "reference" : "unscored",
        };
        return [arm, result];
      }),
    ) as Record<BenchmarkArm, PairedArmResult>;
    const arms = Object.fromEntries(
      BenchmarkArmSchema.options.map((arm) => [
        arm,
        {
          ...preliminaryArms[arm],
          comparisonToTreatment: compareToTreatment(
            preliminaryArms[arm],
            preliminaryArms.decision_tree,
            suite.tieTolerance,
          ),
        },
      ]),
    ) as Record<BenchmarkArm, PairedArmResult>;
    return { caseId: benchmarkCase.caseId, arms };
  });

  const baselines = cases.flatMap((item) => [item.arms.one_shot, item.arms.sequential_grill]);
  return {
    benchmarkVersion: "decision-deliberation-paired-v1",
    suiteId: suite.suiteId,
    computeTolerance: suite.computeTolerance,
    tieTolerance: suite.tieTolerance,
    cases,
    aggregate: {
      computeMatchedBaselines: baselines.filter((item) => item.computeMatchedToTreatment).length,
      totalBaselines: baselines.length,
      treatmentWins: baselines.filter((item) => item.comparisonToTreatment === "loss").length,
      treatmentLosses: baselines.filter((item) => item.comparisonToTreatment === "win").length,
      ties: baselines.filter((item) => item.comparisonToTreatment === "tie").length,
      unscored: baselines.filter((item) => item.comparisonToTreatment === "unscored").length,
    },
    disclaimer: LIVE_BENCHMARK_DISCLAIMER,
  };
}
