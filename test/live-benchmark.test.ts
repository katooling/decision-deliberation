import assert from "node:assert/strict";
import test from "node:test";

import {
  LIVE_BENCHMARK_DISCLAIMER,
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
  assert.equal(result.arms.sequential_grill.comparisonToTreatment, "tie");
  assert.equal(result.arms.one_shot.comparisonToTreatment, "loss");
  assert.equal(report.aggregate.computeMatchedBaselines, 1);
  assert.equal(report.aggregate.totalBaselines, 2);
  assert.equal(report.aggregate.treatmentWins, 1);
  assert.equal(report.aggregate.ties, 1);
  assert.equal(report.disclaimer, LIVE_BENCHMARK_DISCLAIMER);
});

test("paired benchmark markdown exposes unmatched compute and constraints", () => {
  const markdown = renderPairedBenchmarkMarkdown(runPairedBenchmark(suite));
  assert.match(markdown, /UNMATCHED/);
  assert.match(markdown, /Constraint violations/);
  assert.match(markdown, /Exceeded the requested migration window/);
  assert.ok(markdown.includes(LIVE_BENCHMARK_DISCLAIMER));
});
