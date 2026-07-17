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
          strength: "The recommendation is concrete.",
          weakness: "The fixture has bounded evidence.",
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

test("benchmark-baseline CLI preserves its call artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "decision-deliberation-baseline-cli-"));
  try {
    const providerPath = join(directory, "provider.json");
    const reportPath = join(directory, "baseline.json");
    const decision = {
      schemaVersion: 1,
      recommendation: "Use a reversible pilot.",
      reasoning: ["It tests the riskiest assumption first."],
      rankedAlternatives: [{ label: "Full rollout", rationale: "It commits earlier." }],
      assumptions: ["A representative pilot is available."],
      uncertainties: ["Adoption beyond the pilot is unknown."],
    };
    await writeFile(providerPath, `${JSON.stringify({
      type: "scripted",
      responses: { "baseline-designer": JSON.stringify(decision) },
    })}\n`, "utf8");

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("src/cli.ts"),
        "benchmark-baseline",
        resolve("examples/demo/request.json"),
        "--provider",
        providerPath,
        "--arm",
        "one_shot",
        "--rounds",
        "1",
        "--out",
        reportPath,
      ],
      { cwd: process.cwd() },
    );
    const output = JSON.parse(stdout) as {
      status: string;
      artifacts: Array<{ valid: boolean; response?: { text: string } }>;
    };
    assert.equal(output.status, "complete");
    assert.equal(output.artifacts.length, 1);
    assert.equal(output.artifacts[0]?.valid, true);
    assert.equal(output.artifacts[0]?.response?.text, JSON.stringify(decision));
    assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("benchmark-baseline CLI persists failed attempt artifacts before exiting nonzero", async () => {
  const directory = await mkdtemp(join(tmpdir(), "decision-deliberation-baseline-failure-"));
  try {
    const providerPath = join(directory, "provider.json");
    const reportPath = join(directory, "baseline-failure.json");
    await writeFile(providerPath, `${JSON.stringify({
      type: "scripted",
      responses: { "baseline-designer": ["not JSON", "still not JSON"] },
    })}\n`, "utf8");

    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          resolve("src/cli.ts"),
          "benchmark-baseline",
          resolve("examples/demo/request.json"),
          "--provider",
          providerPath,
          "--arm",
          "one_shot",
          "--rounds",
          "1",
          "--out",
          reportPath,
        ],
        { cwd: process.cwd() },
      ),
      /structured output remained invalid/,
    );
    const failure = JSON.parse(await readFile(reportPath, "utf8")) as {
      status: string;
      calls: number;
      artifacts: Array<{ valid: boolean }>;
    };
    assert.equal(failure.status, "failed");
    assert.equal(failure.calls, 2);
    assert.deepEqual(failure.artifacts.map((artifact) => artifact.valid), [false, false]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
