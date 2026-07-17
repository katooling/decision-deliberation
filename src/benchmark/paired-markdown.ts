import { BenchmarkArmSchema, type PairedBenchmarkReport } from "./paired-contract.js";

function score(value: number | undefined): string {
  return value === undefined ? "—" : value.toFixed(3);
}

function cost(value: number | null): string {
  return value === null ? "—" : `$${value.toFixed(4)}`;
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
    "| Case | Arm | Status | Comparison | Composite | Tokens | Ratio | Compute | Calls | Latency | Cost |",
    "|---|---|---|---|---:|---:|---:|---|---:|---:|---:|",
    ...report.cases.flatMap((item) => BenchmarkArmSchema.options.map((arm) => {
      const result = item.arms[arm];
      const ratio = result.tokenRatioToTreatment === null
        ? "—"
        : result.tokenRatioToTreatment.toFixed(3);
      return `| ${item.caseId} | ${arm} | ${result.status} | ${result.comparisonToTreatment} | ${score(result.meanScore?.composite)} | ${result.totalTokens} | ${ratio} | ${result.computeMatchedToTreatment ? "MATCHED" : "UNMATCHED"} | ${result.calls} | ${Math.round(result.latencyMs)} ms | ${cost(result.costUsd)} |`;
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
