import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's native TypeScript runner requires the source extension.
const benchmark = await import("../src/benchmark/index.ts");
const {
  renderBenchmarkMarkdown,
  runSyntheticBenchmark,
  SYNTHETIC_BENCHMARK_DISCLAIMER,
} = benchmark;

test("quick synthetic benchmark is byte-stable for a fixed seed", () => {
  const first = runSyntheticBenchmark();
  const second = runSyntheticBenchmark();
  assert.deepEqual(first, second);
  assert.equal(renderBenchmarkMarkdown(first), renderBenchmarkMarkdown(second));
});

test("exhaustive hindsight covers every path and materially beats greedy local choice", () => {
  const report = runSyntheticBenchmark();
  assert.equal(report.gate.passed, true);
  assert.equal(report.aggregate.treatment.admittedPathCoverage, 1);
  assert.equal(report.aggregate.treatment.exactOptimalRate, 1);
  assert.equal(report.aggregate.treatment.normalizedRegret, 0);
  assert.ok(report.aggregate.normalizedRegretImprovement >= 0.1);

  for (const fixture of report.cases) {
    assert.equal(fixture.localRecommendationIsTrap, true);
    assert.notEqual(fixture.greedyPath, fixture.optimalPath);
    assert.equal(fixture.treatment.selectedPath, fixture.optimalPath);
    assert.equal(fixture.treatment.evaluatedPaths, fixture.admittedPaths);
    assert.equal(fixture.treatment.admittedPathCoverage, 1);
  }
});

test("markdown reports operational cost and the fixed claim disclaimer", () => {
  const report = runSyntheticBenchmark({ seed: 12345 });
  const markdown = renderBenchmarkMarkdown(report);
  assert.match(markdown, /Nodes \| Calls/);
  assert.match(markdown, /Greedy local baseline/);
  assert.match(markdown, /Exhaustive hindsight/);
  assert.ok(markdown.includes(SYNTHETIC_BENCHMARK_DISCLAIMER));
});
