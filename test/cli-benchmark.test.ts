import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

const arms = ["one_shot", "sequential_grill", "decision_tree"] as const;

test("benchmark-compare CLI validates observations and writes the selected report format", async () => {
  const directory = await mkdtemp(join(tmpdir(), "decision-deliberation-benchmark-cli-"));
  try {
    const suitePath = join(directory, "suite.json");
    const reportPath = join(directory, "report.json");
    await writeFile(suitePath, `${JSON.stringify({
      schemaVersion: 1,
      suiteId: "cli-fixture",
      computeTolerance: 0.1,
      tieTolerance: 0.01,
      cases: [{
        caseId: "case_1",
        artifacts: arms.map((arm, index) => ({
          artifactId: `artifact_${index}`,
          arm,
          status: "complete",
          calls: index + 1,
          usage: { inputTokens: 80, outputTokens: 20, latencyMs: 100 },
          constraintViolations: [],
        })),
        reviews: arms.map((_arm, index) => ({
          reviewerId: "reviewer_1",
          artifactId: `artifact_${index}`,
          scores: { decisionQuality: 0.7, coverage: 0.7, traceability: 0.7 },
        })),
      }],
    }, null, 2)}\n`, "utf8");

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("src/cli.ts"),
        "benchmark-compare",
        suitePath,
        "--json",
        "--out",
        reportPath,
      ],
      { cwd: process.cwd() },
    );
    const report = JSON.parse(stdout) as {
      benchmarkVersion: string;
      aggregate: { computeMatchedBaselines: number };
    };
    assert.equal(report.benchmarkVersion, "decision-deliberation-paired-v1");
    assert.equal(report.aggregate.computeMatchedBaselines, 2);
    assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), report);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
