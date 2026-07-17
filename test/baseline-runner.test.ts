import assert from "node:assert/strict";
import test from "node:test";

import type { AgentRequest } from "../src/agents/provider.js";
import { runBaselineSeries } from "../src/benchmark/baseline.js";
import type { DecisionRequest } from "../src/domain/schemas.js";
import { ScriptedProvider } from "../src/providers/scripted-provider.js";

const request: DecisionRequest = {
  schemaVersion: 1,
  title: "Storage",
  decisionStatement: "Choose canonical storage.",
  context: "A local replayable tool.",
  scope: {
    inScope: ["Files and embedded databases"],
    outOfScope: ["Hosted services"],
    constraints: ["History stays append-only"],
  },
  criteria: [
    {
      key: "integrity",
      label: "Integrity",
      description: "Replay integrity.",
      weight: 1,
      zeroAnchor: "History is mutable",
      oneAnchor: "History is replayable",
    },
  ],
};

function decision(round: number): string {
  return JSON.stringify({
    schemaVersion: 1,
    recommendation: `Recommendation ${round}`,
    reasoning: [`Reasoning ${round}`],
    rankedAlternatives: [{ label: "Alternative", rationale: `Alternative ${round}` }],
    assumptions: ["Fixture assumption"],
    uncertainties: ["Fixture uncertainty"],
  });
}

test("sequential baseline carries prior decisions forward and aggregates observed usage", async () => {
  const requests: AgentRequest[] = [];
  const provider = new ScriptedProvider(async (agentRequest) => {
    requests.push(agentRequest);
    const round = requests.length;
    return {
      text: decision(round),
      usage: { inputTokens: 100 * round, outputTokens: 20 * round, latencyMs: 50 * round },
    };
  });

  const result = await runBaselineSeries({
    provider,
    request,
    arm: "sequential_grill",
    rounds: 3,
    maxAttemptsPerCall: 1,
  });

  assert.equal(result.calls, 3);
  assert.equal(result.decision.recommendation, "Recommendation 3");
  assert.deepEqual(result.usage, {
    inputTokens: 600,
    outputTokens: 120,
    costUsd: null,
    latencyMs: 300,
  });
  assert.equal(requests[0]?.role, "baseline-designer");
  assert.equal((requests[0]?.input as { previousDecision: unknown }).previousDecision, null);
  assert.equal(
    ((requests[1]?.input as { previousDecision: { recommendation: string } }).previousDecision)
      .recommendation,
    "Recommendation 1",
  );
});

test("one-shot baseline cannot silently use multiple rounds", async () => {
  const provider = new ScriptedProvider(() => decision(1));
  await assert.rejects(
    runBaselineSeries({ provider, request, arm: "one_shot", rounds: 2 }),
    /one_shot requires exactly one round/,
  );
});

test("baseline retries keep one logical call ID and distinct attempt artifacts", async () => {
  const provider = new ScriptedProvider([
    "not valid JSON",
    decision(1),
  ]);
  const result = await runBaselineSeries({
    provider,
    request,
    arm: "one_shot",
    rounds: 1,
    maxAttemptsPerCall: 2,
    callIdPrefix: "benchmark.fixture.one_shot",
  });

  assert.equal(result.artifacts.length, 2);
  assert.deepEqual(
    result.artifacts.map((artifact) => artifact.callId),
    ["benchmark.fixture.one_shot.round-1", "benchmark.fixture.one_shot.round-1"],
  );
  assert.equal(new Set(result.artifacts.map((artifact) => artifact.artifactId)).size, 2);
});
