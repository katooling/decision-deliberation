import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AgentRequest } from "../src/agents/provider.js";
import type { BootstrapConfiguration, DecisionRequest } from "../src/domain/schemas.js";
import { FileRunStore } from "../src/persistence/file-run-store.js";
import {
  DecisionProduct,
  ProductWorkflowError,
} from "../src/product/workflow.js";
import { renderDecisionAdr } from "../src/product/adr.js";
import { ScriptedProvider } from "../src/providers/scripted-provider.js";

const framedRequest: DecisionRequest = {
  schemaVersion: 1,
  title: "Choose the product launch sequence",
  decisionStatement: "Should the team launch the API or dashboard first?",
  context: "Success means validated demand within one quarter. The team has four engineers.",
  scope: {
    inScope: ["API-first launch", "Dashboard-first launch"],
    outOfScope: ["Changing the target market"],
    constraints: ["Ship a useful first release within six weeks"],
  },
  criteria: [
    {
      key: "validated_demand",
      label: "Validated demand",
      description: "How quickly the path produces credible customer demand evidence.",
      weight: 0.7,
      zeroAnchor: "No credible demand evidence",
      oneAnchor: "Strong repeated demand evidence",
    },
    {
      key: "reversibility",
      label: "Reversibility",
      description: "How cheaply the team can change direction after learning.",
      weight: 0.3,
      zeroAnchor: "The choice is expensive to reverse",
      oneAnchor: "The choice is cheap to reverse",
    },
  ],
};

const productConfig: BootstrapConfiguration = {
  schemaVersion: 1,
  completion: "coverage",
  traversal: "bfs",
  questionPipeline: { proposerCount: 1, reviewerCount: 1, synthesizerCount: 1 },
  options: { min: 2, target: 2, max: 3 },
  limits: { maxDepth: 1, maxNodes: 8, maxQuestions: 2, maxAgentCalls: 12 },
  concurrency: 1,
  maxAttemptsPerCall: 2,
  evaluatorCount: 1,
  confidencePenalty: 0,
};

const conclusion = {
  summary: "API-first exposes the riskiest demand assumption with the least interface work.",
  recommendation: "Launch a narrow API pilot before building the dashboard.",
  conditions: ["Two design partners commit to the pilot."],
  caveats: ["Dashboard usability remains untested."],
  unresolvedQuestions: ["Which authentication flow creates the least onboarding friction?"],
};

function interviewTurn(ready: boolean): string {
  return JSON.stringify({
    schemaVersion: 1,
    reflection: ready
      ? "The outcome, constraint, and comparison are now clear enough to frame."
      : "The decision names two launch paths but not what success means.",
    ready,
    question: ready ? null : "What result six months from now would make this decision clearly successful?",
    rationale: ready ? null : "The answer determines how the launch paths should be compared.",
  });
}

function productProvider(): ScriptedProvider {
  return new ScriptedProvider((request: AgentRequest) => {
    switch (request.role) {
      case "decision-interviewer": {
        const input = request.input as { answers: unknown[] };
        return interviewTurn(input.answers.length > 0);
      }
      case "decision-framer":
        return JSON.stringify(framedRequest);
      case "question-proposer":
      case "question-synthesizer":
        return JSON.stringify({ schemaVersion: 1, resolution: { type: "conclude", conclusion } });
      case "coverage-reviewer":
        return JSON.stringify({
          schemaVersion: 1,
          findings: {
            missingAngles: [],
            overlaps: [],
            atomicityIssues: [],
            exclusivityIssues: [],
            pathContextRisks: [],
          },
          synthesisInstructions: ["Conclude because the supplied framing resolves the fixture."],
          preferredProposalIndexes: [0],
        });
      case "branch-evaluator":
        return JSON.stringify({
          schemaVersion: 1,
          conclusion,
          criterionScores: [
            {
              criterionKey: "validated_demand",
              score: 0.86,
              rationale: "The API pilot tests demand before dashboard investment.",
            },
            {
              criterionKey: "reversibility",
              score: 0.9,
              rationale: "The pilot avoids committing to the full dashboard.",
            },
          ],
          confidence: 0.82,
          evidence: [{
            claim: "The pilot isolates the main demand assumption.",
            source: "The supplied product context",
            strength: "moderate",
          }],
          assumptions: ["Design partners represent the initial market."],
          caveats: ["This is a bounded product decision, not market proof."],
        });
      case "baseline-designer":
        throw new Error("The product workflow must not invoke a benchmark baseline.");
    }
  });
}

test("product workflow asks one material question, frames the decision, and persists a dossier", async () => {
  const root = await mkdtemp(join(tmpdir(), "decision-product-workflow-"));
  try {
    const provider = productProvider();
    const product = new DecisionProduct({
      provider,
      store: new FileRunStore(root),
      config: productConfig,
      maxQuestions: 4,
    });

    const question = await product.begin({
      decision: "Should we launch the API or dashboard first?",
      context: "Four engineers; six weeks for the first release.",
    });
    assert.equal(question.status, "question");
    assert.match(question.question.text, /six months/);
    assert.equal(question.answers.length, 0);

    const ready = await product.answer(question.sessionId, {
      answer: "Two design partners use it weekly and ask to pay for continued access.",
    });
    assert.equal(ready.status, "ready");
    assert.equal(ready.framing.title, framedRequest.title);
    assert.equal(ready.answers.length, 1);

    await assert.rejects(
      product.answer(question.sessionId, { answer: "A second answer should be rejected." }),
      (error: unknown) => error instanceof ProductWorkflowError && error.status === 409,
    );

    const result = await product.deliberate(question.sessionId);
    assert.equal(result.status, "complete");
    assert.equal(result.dossier.recommendation?.recommendation, conclusion.recommendation);
    assert.match(result.adr, /# ADR: Choose the product launch sequence/);
    assert.match(result.adr, /## Recommendation/);
    assert.match(result.adr, /## Assumptions/);
    assert.match(result.adr, /## Evidence/);

    assert.deepEqual(
      provider.calls.slice(0, 3).map((call) => call.role),
      ["decision-interviewer", "decision-interviewer", "decision-framer"],
    );
    const framingInput = provider.calls[2]?.input as { answers: Array<{ answer: string }> };
    assert.equal(framingInput.answers[0]?.answer, ready.answers[0]?.answer);

    const runDirectory = join(root, result.runId);
    assert.equal(JSON.parse(await readFile(join(runDirectory, "dossier.json"), "utf8")).runId, result.runId);
    assert.equal(await readFile(join(runDirectory, "decision.md"), "utf8"), result.adr);
    assert.ok((await readdir(join(runDirectory, "calls"))).some((name) => name.includes("decision-interviewer")));

    const restarted = new DecisionProduct({
      provider: productProvider(),
      store: new FileRunStore(root),
      config: productConfig,
    });
    assert.equal(await restarted.exportAdr(result.runId), result.adr);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("question budget deterministically forces framing instead of asking an extra question", async () => {
  const root = await mkdtemp(join(tmpdir(), "decision-product-budget-"));
  try {
    const provider = new ScriptedProvider((request) => {
      if (request.role === "decision-interviewer") return interviewTurn(false);
      if (request.role === "decision-framer") return JSON.stringify(framedRequest);
      throw new Error(`Unexpected role ${request.role}`);
    });
    const product = new DecisionProduct({
      provider,
      store: new FileRunStore(root),
      config: productConfig,
      maxQuestions: 1,
    });

    const question = await product.begin({ decision: "Which launch path should we choose?" });
    const ready = await product.answer(question.sessionId, { answer: "Validated demand within one quarter." });

    assert.equal(ready.status, "ready");
    assert.deepEqual(provider.calls.map((call) => call.role), ["decision-interviewer", "decision-framer"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a failed follow-up leaves the same question answerable instead of corrupting session state", async () => {
  const root = await mkdtemp(join(tmpdir(), "decision-product-retry-"));
  try {
    let failed = false;
    const provider = new ScriptedProvider((request) => {
      if (request.role === "decision-interviewer") {
        const answers = (request.input as { answers: unknown[] }).answers;
        if (answers.length === 0) return interviewTurn(false);
        if (!failed) {
          failed = true;
          throw new Error("temporary interview failure");
        }
        return interviewTurn(true);
      }
      if (request.role === "decision-framer") return JSON.stringify(framedRequest);
      throw new Error(`Unexpected role ${request.role}`);
    });
    const product = new DecisionProduct({
      provider,
      store: new FileRunStore(root),
      config: { ...productConfig, maxAttemptsPerCall: 1 },
      maxQuestions: 3,
    });

    const question = await product.begin({ decision: "Which product launch path should we choose?" });
    assert.equal(question.status, "question");
    await assert.rejects(
      product.answer(question.sessionId, { answer: "Validate demand this quarter." }),
      /structured output remained invalid/,
    );
    const ready = await product.answer(question.sessionId, { answer: "Validate demand this quarter." });

    assert.equal(ready.status, "ready");
    assert.equal(ready.answers.length, 1);
    assert.equal(ready.answers[0]?.question, question.question.text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed framing calls remain in persisted provenance with unique invocation IDs", async () => {
  const root = await mkdtemp(join(tmpdir(), "decision-product-provenance-"));
  try {
    const base = productProvider();
    let failFraming = true;
    const provider = new ScriptedProvider(async (request) => {
      if (request.role === "decision-framer" && failFraming) {
        failFraming = false;
        return new Error("temporary framing failure");
      }
      return base.invoke(request);
    });
    const product = new DecisionProduct({
      provider,
      store: new FileRunStore(root),
      config: { ...productConfig, maxAttemptsPerCall: 1 },
      maxQuestions: 3,
    });

    const question = await product.begin({ decision: "Which product launch path should we choose?" });
    await assert.rejects(
      product.answer(question.sessionId, { answer: "Validate demand this quarter." }),
      /structured output remained invalid/,
    );
    const ready = await product.answer(question.sessionId, { answer: "Validate demand this quarter." });
    assert.equal(ready.status, "ready");
    const result = await product.deliberate(question.sessionId);

    const callDirectory = join(root, result.runId, "calls");
    const artifacts = await Promise.all(
      (await readdir(callDirectory)).map(async (name) =>
        JSON.parse(await readFile(join(callDirectory, name), "utf8")) as {
          artifactId: string;
          callId: string;
          valid: boolean;
          violations: string[];
        }),
    );
    const intakeArtifacts = artifacts.filter((artifact) => artifact.callId.startsWith(question.sessionId));
    assert.equal(intakeArtifacts.length, 5);
    assert.equal(new Set(intakeArtifacts.map((artifact) => artifact.artifactId)).size, 5);
    assert.ok(intakeArtifacts.some(
      (artifact) => !artifact.valid && artifact.violations.includes("temporary framing failure"),
    ));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ADR export keeps recommendation status, alternatives, uncertainty, and approval explicit", () => {
  const dossier = {
    schemaVersion: 1 as const,
    runId: "run_fixture",
    title: framedRequest.title,
    decisionStatement: framedRequest.decisionStatement,
    completeness: "partial_budget_exhausted" as const,
    recommendation: {
      rank: 1,
      branchId: "branch_a",
      score: 0.86,
      rawScore: 0.86,
      confidence: 0.82,
      summary: conclusion.summary,
      recommendation: conclusion.recommendation,
      path: [],
      conditions: conclusion.conditions,
      caveats: conclusion.caveats,
    },
    rankedAlternatives: [{
      rank: 2,
      branchId: "branch_b",
      score: 0.68,
      rawScore: 0.68,
      confidence: 0.74,
      summary: "Dashboard-first demonstrates the complete experience sooner.",
      recommendation: "Prototype the dashboard first.",
      path: [],
      conditions: [],
      caveats: ["Demand risk remains."],
    }],
    reasoning: {
      assumptions: ["Design partners represent the initial market."],
      tradeoffs: ["API-first delays visual workflow validation."],
      unresolvedQuestions: conclusion.unresolvedQuestions,
    },
    evidence: [{
      claim: "The pilot isolates the main demand assumption.",
      source: "The supplied product context",
      strength: "moderate" as const,
    }],
    uncertainty: {
      unscoredBranchIds: ["branch_c"],
      sources: ["The dashboard path was not fully evaluated."],
    },
    exploration: {
      rootBranchId: "branch_root",
      branchCount: 3,
      questionCount: 1,
      maxDepth: 1,
      branches: {},
      expansions: {},
      edges: [],
    },
    aggregation: { root: null, subtrees: {} },
    stats: {
      questions: 1,
      agentCalls: 8,
      retries: 0,
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0,
      wallTimeMs: 1_000,
      eventCount: 12,
      evaluatedLeaves: 2,
    },
    approval: { status: "awaiting_human_approval" as const },
  };

  const adr = renderDecisionAdr(dossier);
  assert.match(adr, /Status: Proposed — awaiting human approval/);
  assert.match(adr, /Partial evidence: partial_budget_exhausted/);
  assert.match(adr, /Prototype the dashboard first/);
  assert.match(adr, /Why it ranked lower: 18.0 points behind/);
  assert.match(adr, /The dashboard path was not fully evaluated/);
  assert.match(adr, /Decision Deliberation does not execute this recommendation/);
});
