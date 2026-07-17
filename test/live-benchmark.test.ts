import assert from "node:assert/strict";
import test from "node:test";

import {
  LIVE_BENCHMARK_DISCLAIMER,
  type PairedBenchmarkSuite,
  renderPairedBenchmarkMarkdown,
  runPairedBenchmark,
} from "../src/benchmark/live.js";

const suite = {
  schemaVersion: 1 as const,
  suiteId: "paired-fixture-v1",
  computeTolerance: 0.15,
  tieTolerance: 0.01,
  cases: [
    {
      caseId: "storage",
      artifacts: [
        {
          artifactId: "artifact_red",
          arm: "one_shot" as const,
          status: "complete" as const,
          calls: 1,
          usage: { inputTokens: 700, outputTokens: 200, latencyMs: 800, costUsd: 0.02 },
          constraintViolations: [],
        },
        {
          artifactId: "artifact_blue",
          arm: "sequential_grill" as const,
          status: "complete" as const,
          calls: 4,
          usage: { inputTokens: 950, outputTokens: 250, latencyMs: 1_500, costUsd: 0.04 },
          constraintViolations: ["Exceeded the requested migration window."],
        },
        {
          artifactId: "artifact_green",
          arm: "decision_tree" as const,
          status: "complete" as const,
          calls: 12,
          usage: { inputTokens: 800, outputTokens: 200, latencyMs: 2_400, costUsd: 0.05 },
          constraintViolations: [],
        },
      ],
      reviews: [
        {
          reviewerId: "reviewer_1",
          artifactId: "artifact_red",
          scores: { decisionQuality: 0.6, coverage: 0.55, traceability: 0.4 },
        },
        {
          reviewerId: "reviewer_1",
          artifactId: "artifact_blue",
          scores: { decisionQuality: 0.8, coverage: 0.8, traceability: 0.8 },
        },
        {
          reviewerId: "reviewer_1",
          artifactId: "artifact_green",
          scores: { decisionQuality: 0.8, coverage: 0.8, traceability: 0.8 },
        },
      ],
    },
  ],
};

test("paired benchmark separates blinded quality from compute matching", () => {
  const report = runPairedBenchmark(suite);
  const result = report.cases[0];
  assert.ok(result);

  assert.equal(result.arms.one_shot.computeMatchedToTreatment, true);
  assert.equal(result.arms.one_shot.tokenRatioToTreatment, 0.9);
  assert.equal(result.arms.sequential_grill.computeMatchedToTreatment, false);
  assert.equal(result.arms.sequential_grill.tokenRatioToTreatment, 1.2);
  assert.equal(result.arms.decision_tree.computeMatchedToTreatment, true);
  assert.equal(result.arms.one_shot.meanScore?.composite, 0.516667);
  assert.equal(result.arms.sequential_grill.comparisonToTreatment, "unscored");
  assert.equal(result.arms.one_shot.comparisonToTreatment, "loss");
  assert.equal(report.aggregate.computeMatchedBaselines, 1);
  assert.equal(report.aggregate.totalBaselines, 2);
  assert.equal(report.aggregate.treatmentWins, 1);
  assert.equal(report.aggregate.ties, 0);
  assert.equal(report.aggregate.unscored, 1);
  assert.equal(report.disclaimer, LIVE_BENCHMARK_DISCLAIMER);
});

test("paired benchmark markdown exposes unmatched compute and constraints", () => {
  const markdown = renderPairedBenchmarkMarkdown(runPairedBenchmark(suite));
  assert.match(markdown, /UNMATCHED/);
  assert.match(markdown, /Cost/);
  assert.match(markdown, /\$0\.0200/);
  assert.match(markdown, /Constraint violations/);
  assert.match(markdown, /Exceeded the requested migration window/);
  assert.ok(markdown.includes(LIVE_BENCHMARK_DISCLAIMER));
});

test("incomplete, missing, failed, and constraint-violating observations remain unscored", () => {
  const incomplete: PairedBenchmarkSuite = structuredClone(suite);
  const benchmarkCase = incomplete.cases[0];
  assert.ok(benchmarkCase);
  benchmarkCase.artifacts[0]!.status = "failed";
  benchmarkCase.artifacts[1]!.status = "missing";
  benchmarkCase.artifacts[1]!.calls = 0;
  benchmarkCase.artifacts[1]!.usage = { inputTokens: 0, outputTokens: 0, latencyMs: 0 };
  benchmarkCase.artifacts[1]!.constraintViolations = [];
  benchmarkCase.artifacts[2]!.status = "partial";
  benchmarkCase.reviews = benchmarkCase.reviews.filter(
    (review) => review.artifactId !== benchmarkCase.artifacts[1]!.artifactId,
  );

  const report = runPairedBenchmark(incomplete);

  assert.equal(report.cases[0]!.arms.one_shot.comparisonToTreatment, "unscored");
  assert.equal(report.cases[0]!.arms.sequential_grill.comparisonToTreatment, "unscored");
  assert.equal(report.cases[0]!.arms.sequential_grill.computeMatchedToTreatment, false);
  assert.deepEqual(report.aggregate, {
    computeMatchedBaselines: 1,
    totalBaselines: 2,
    treatmentWins: 0,
    treatmentLosses: 0,
    ties: 0,
    unscored: 2,
  });
});

test("paired benchmark rejects duplicate cases and duplicate reviewer joins", () => {
  const duplicateCase = structuredClone(suite);
  duplicateCase.cases.push(structuredClone(duplicateCase.cases[0]!));
  assert.throws(() => runPairedBenchmark(duplicateCase), /case IDs must be unique/);

  const duplicateReview = structuredClone(suite);
  duplicateReview.cases[0]!.reviews.push(structuredClone(duplicateReview.cases[0]!.reviews[0]!));
  assert.throws(() => runPairedBenchmark(duplicateReview), /reviewer may score each artifact only once/);
});
