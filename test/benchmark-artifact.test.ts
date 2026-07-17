import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  normalizeBaselineArtifact,
  normalizeDossierArtifact,
} from "../src/benchmark/artifact.js";
import type { DecisionDossier } from "../src/core/dossier.js";
import { BaselineDecisionSchema } from "../src/domain/schemas.js";

test("normalized benchmark artifacts hide arm-specific operational details", async () => {
  const baseline = BaselineDecisionSchema.parse({
    schemaVersion: 1,
    recommendation: "Use portable files.",
    reasoning: ["They preserve inspectability."],
    rankedAlternatives: [{ label: "SQLite", rationale: "It improves querying." }],
    assumptions: ["Files are durable."],
    uncertainties: ["Scale is unknown."],
  });
  const dossier = JSON.parse(
    await readFile(resolve("test/fixtures/viewer-demo/dossier.json"), "utf8"),
  ) as DecisionDossier;

  const normalizedBaseline = normalizeBaselineArtifact(baseline);
  const normalizedDossier = normalizeDossierArtifact(dossier);

  assert.deepEqual(Object.keys(normalizedBaseline), Object.keys(normalizedDossier));
  assert.equal(normalizedBaseline.recommendation, "Use portable files.");
  assert.ok(normalizedDossier.recommendation.length > 0);
  for (const artifact of [normalizedBaseline, normalizedDossier]) {
    const serialized = JSON.stringify(artifact);
    assert.doesNotMatch(serialized, /runId|branchId|agentCalls|inputTokens|decision_tree|one_shot/);
  }
});
