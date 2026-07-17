import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  BootstrapConfigurationSchema,
  DecisionRequestSchema,
} from "../src/domain/schemas.js";
import { runPairedBenchmark } from "../src/benchmark/live.js";

const caseNames = ["knowledge-migration", "release-distribution", "run-storage"];

test("packaged validation cases and bounded configurations satisfy public schemas", async () => {
  for (const configName of ["config-smoke.json", "config.json"]) {
    const config = BootstrapConfigurationSchema.parse(
      JSON.parse(await readFile(resolve("examples/validation", configName), "utf8")),
    );
    assert.ok(config.limits.maxAgentCalls <= 96);
    assert.ok(config.limits.maxNodes <= 24);
    assert.ok(config.limits.maxWallTimeMs !== undefined);
  }

  for (const caseName of caseNames) {
    const path = resolve("examples/validation", caseName, "request.json");
    const source = await readFile(path, "utf8");
    const request = DecisionRequestSchema.parse(JSON.parse(source));
    assert.ok(request.criteria.length >= 4);
    assert.equal(new Set(request.criteria.map((criterion) => criterion.key)).size, request.criteria.length);
    assert.doesNotMatch(source, /\/Users\/|\/home\/|@agoda\.com|github_pat_|gh[pousr]_|sk-/);
  }

  const pendingSuite = JSON.parse(
    await readFile(resolve("examples/validation/paired-observations.template.json"), "utf8"),
  ) as unknown;
  const report = runPairedBenchmark(pendingSuite);
  assert.equal(report.cases.length, 3);
  assert.equal(report.aggregate.unscored, 6);
  assert.equal(report.aggregate.computeMatchedBaselines, 0);
});
