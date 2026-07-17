import { z } from "zod";

const BenchmarkArmSchema = z.enum(["one_shot", "sequential_grill", "decision_tree"]);
const BenchmarkStatusSchema = z.enum(["complete", "partial", "failed"]);
const UnitScore = z.number().min(0).max(1);
const NonNegative = z.number().nonnegative();

export const PairedBenchmarkSuiteSchema = z
  .object({
    schemaVersion: z.literal(1),
    suiteId: z.string().trim().min(1),
    computeTolerance: z.number().min(0).max(1),
    tieTolerance: z.number().min(0).max(1),
    cases: z.array(
      z
        .object({
          caseId: z.string().trim().min(1),
          artifacts: z.array(
            z
              .object({
                artifactId: z.string().trim().min(1),
                arm: BenchmarkArmSchema,
                status: BenchmarkStatusSchema,
                calls: z.number().int().nonnegative(),
                usage: z
                  .object({
                    inputTokens: z.number().int().nonnegative(),
                    outputTokens: z.number().int().nonnegative(),
                    latencyMs: NonNegative,
                    costUsd: NonNegative.optional(),
                  })
                  .strict(),
                constraintViolations: z.array(z.string().trim().min(1)),
              })
              .strict(),
          ),
          reviews: z.array(
            z
              .object({
                reviewerId: z.string().trim().min(1),
                artifactId: z.string().trim().min(1),
                scores: z
                  .object({
                    decisionQuality: UnitScore,
                    coverage: UnitScore,
                    traceability: UnitScore,
                  })
                  .strict(),
              })
              .strict(),
          ),
        })
        .strict()
        .superRefine((value, context) => {
          const artifactIds = value.artifacts.map((artifact) => artifact.artifactId);
          if (new Set(artifactIds).size !== artifactIds.length) {
            context.addIssue({ code: "custom", path: ["artifacts"], message: "artifact IDs must be unique" });
          }
          const arms = value.artifacts.map((artifact) => artifact.arm);
          if (new Set(arms).size !== arms.length) {
            context.addIssue({ code: "custom", path: ["artifacts"], message: "each arm must have exactly one artifact" });
          }
          for (const arm of BenchmarkArmSchema.options) {
            if (!arms.includes(arm)) {
              context.addIssue({ code: "custom", path: ["artifacts"], message: `missing ${arm} artifact` });
            }
          }
          for (const [index, review] of value.reviews.entries()) {
            if (!artifactIds.includes(review.artifactId)) {
              context.addIssue({
                code: "custom",
                path: ["reviews", index, "artifactId"],
                message: "review must reference an artifact in the same case",
              });
            }
          }
        }),
    ).min(1),
  })
  .strict();

export type PairedBenchmarkSuite = z.infer<typeof PairedBenchmarkSuiteSchema>;
export type BenchmarkArm = z.infer<typeof BenchmarkArmSchema>;
export type BenchmarkComparison = "win" | "loss" | "tie" | "reference" | "unscored";

export interface MeanBenchmarkScore {
  decisionQuality: number;
  coverage: number;
  traceability: number;
  composite: number;
  reviewCount: number;
}

export interface PairedArmResult {
  artifactId: string;
  arm: BenchmarkArm;
  status: z.infer<typeof BenchmarkStatusSchema>;
  calls: number;
  totalTokens: number;
  latencyMs: number;
  costUsd: number | null;
  constraintViolations: string[];
  meanScore: MeanBenchmarkScore | null;
  tokenRatioToTreatment: number | null;
  computeMatchedToTreatment: boolean;
  comparisonToTreatment: BenchmarkComparison;
}

export interface PairedCaseResult {
  caseId: string;
  arms: Record<BenchmarkArm, PairedArmResult>;
}

export interface PairedBenchmarkReport {
  benchmarkVersion: "decision-deliberation-paired-v1";
  suiteId: string;
  computeTolerance: number;
  tieTolerance: number;
  cases: PairedCaseResult[];
  aggregate: {
    computeMatchedBaselines: number;
    totalBaselines: number;
    treatmentWins: number;
    treatmentLosses: number;
    ties: number;
    unscored: number;
  };
  disclaimer: string;
}

export const LIVE_BENCHMARK_DISCLAIMER =
  "These paired observations measure only the declared cases, providers, budgets, and reviewers. They do not establish universal decision superiority.";

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
  arm: BenchmarkArm,
  score: MeanBenchmarkScore | null,
  treatment: MeanBenchmarkScore | null,
  tieTolerance: number,
): BenchmarkComparison {
  if (arm === "decision_tree") return "reference";
  if (score === null || treatment === null) return "unscored";
  const delta = score.composite - treatment.composite;
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
    const treatmentScore = meanScore(benchmarkCase.reviews, treatment.artifactId);
    const arms = Object.fromEntries(
      BenchmarkArmSchema.options.map((arm) => {
        const artifact = artifacts[arm];
        const totalTokens = artifact.usage.inputTokens + artifact.usage.outputTokens;
        const tokenRatioToTreatment = treatmentTokens === 0
          ? arm === "decision_tree" ? 1 : null
          : round(totalTokens / treatmentTokens);
        const computeMatchedToTreatment = arm === "decision_tree" || (
          tokenRatioToTreatment !== null &&
          Math.abs(tokenRatioToTreatment - 1) <= suite.computeTolerance
        );
        const score = meanScore(benchmarkCase.reviews, artifact.artifactId);
        const result: PairedArmResult = {
          artifactId: artifact.artifactId,
          arm,
          status: artifact.status,
          calls: artifact.calls,
          totalTokens,
          latencyMs: artifact.usage.latencyMs,
          costUsd: artifact.usage.costUsd ?? null,
          constraintViolations: [...artifact.constraintViolations],
          meanScore: score,
          tokenRatioToTreatment,
          computeMatchedToTreatment,
          comparisonToTreatment: compareToTreatment(
            arm,
            score,
            treatmentScore,
            suite.tieTolerance,
          ),
        };
        return [arm, result];
      }),
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

function score(value: number | undefined): string {
  return value === undefined ? "—" : value.toFixed(3);
}

export function renderPairedBenchmarkMarkdown(report: PairedBenchmarkReport): string {
  const lines = [
    "# Paired Decision Benchmark",
    "",
    `Benchmark: \`${report.benchmarkVersion}\`  `,
    `Suite: \`${report.suiteId}\`  `,
    `Compute tolerance: \`±${(report.computeTolerance * 100).toFixed(1)}%\``,
    "",
    "Reviewer scores are joined to blinded artifact IDs after review. Compute matching is reported independently from quality.",
    "",
    "| Case | Arm | Status | Composite | Tokens | Ratio | Compute | Calls | Latency |",
    "|---|---|---|---:|---:|---:|---|---:|---:|",
    ...report.cases.flatMap((item) => BenchmarkArmSchema.options.map((arm) => {
      const result = item.arms[arm];
      const ratio = result.tokenRatioToTreatment === null
        ? "—"
        : result.tokenRatioToTreatment.toFixed(3);
      return `| ${item.caseId} | ${arm} | ${result.status} | ${score(result.meanScore?.composite)} | ${result.totalTokens} | ${ratio} | ${result.computeMatchedToTreatment ? "MATCHED" : "UNMATCHED"} | ${result.calls} | ${Math.round(result.latencyMs)} ms |`;
    })),
    "",
    "## Aggregate",
    "",
    `- Compute-matched baselines: ${report.aggregate.computeMatchedBaselines}/${report.aggregate.totalBaselines}`,
    `- Treatment wins: ${report.aggregate.treatmentWins}`,
    `- Treatment losses: ${report.aggregate.treatmentLosses}`,
    `- Ties: ${report.aggregate.ties}`,
    `- Unscored comparisons: ${report.aggregate.unscored}`,
    "",
    "## Constraint violations",
    "",
    ...report.cases.flatMap((item) => BenchmarkArmSchema.options.flatMap((arm) => {
      const violations = item.arms[arm].constraintViolations;
      return violations.length === 0
        ? []
        : violations.map((violation) => `- \`${item.caseId}/${arm}\`: ${violation}`);
    })),
    ...(report.cases.every((item) =>
      BenchmarkArmSchema.options.every((arm) => item.arms[arm].constraintViolations.length === 0)
    ) ? ["- None"] : []),
    "",
    `> ${report.disclaimer}`,
  ];
  return `${lines.join("\n")}\n`;
}
