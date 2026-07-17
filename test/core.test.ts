import assert from "node:assert/strict";
import test from "node:test";

import {
  BootstrapConfigurationSchema,
  DecisionRequestSchema,
  applyEvent,
  assembleDossier,
  assertGraphInvariants,
  backpropagate,
  branchStateHash,
  canonicalJson,
  checkTermination,
  createApprovalRecordedEvent,
  createBranchConcludedEvent,
  createBranchClosedEvent,
  createBranchEvaluatedEvent,
  createBranchExpandedEvent,
  createRunCompletedEvent,
  createRunCreatedEvent,
  mapConcurrentStable,
  parseStructuredJson,
  replay,
  selectFrontier,
  type BootstrapConfiguration,
  type BranchEvaluation,
  type DecisionRequest,
  type DecisionState,
  type FinalResolution,
} from "../src/index.js";

const request: DecisionRequest = DecisionRequestSchema.parse({
  schemaVersion: 1,
  title: "Core fixture",
  decisionStatement: "Choose the strongest path.",
  context: "Unit-test context.",
  scope: { inScope: ["fixture"], outOfScope: [], constraints: [] },
  criteria: [
    {
      key: "utility",
      label: "Utility",
      description: "Fixture utility.",
      weight: 1,
      zeroAnchor: "No utility",
      oneAnchor: "Maximum utility",
    },
  ],
});

const config: BootstrapConfiguration = BootstrapConfigurationSchema.parse({
  schemaVersion: 1,
  completion: "coverage",
  traversal: "bfs",
  questionPipeline: { proposerCount: 3, reviewerCount: 1, synthesizerCount: 1 },
  options: { min: 2, target: 2, max: 3 },
  limits: { maxDepth: 3, maxNodes: 50, maxQuestions: 20, maxAgentCalls: 100 },
  concurrency: 4,
  maxAttemptsPerCall: 2,
  evaluatorCount: 3,
  confidencePenalty: 0,
});

function expansion(keys = ["a", "b"]): FinalResolution {
  return {
    type: "expand",
    question: {
      semanticKey: "choice",
      text: "Which option?",
      rationale: "The choice changes the outcome.",
      resolves: ["choice"],
      options: keys.map((key) => ({
        key,
        label: key.toUpperCase(),
        description: `Choose ${key}.`,
        expectedConsequences: [`committed:${key}`],
        assumptions: [],
        tradeoffs: [],
      })),
      recommendation: { optionKey: keys[0] ?? "a", reason: "Local preference.", confidence: 0.7 },
      coverageRationale: "The fixture defines the complete set.",
      atomicityRationale: "Each option is one choice.",
      exclusivityRationale: "Only one option can be chosen.",
    },
  };
}

function initialState(overrides: Partial<BootstrapConfiguration> = {}): DecisionState {
  const merged = BootstrapConfigurationSchema.parse({ ...config, ...overrides });
  return applyEvent(undefined, createRunCreatedEvent("core-run", request, merged));
}

function expandedRoot(overrides: Partial<BootstrapConfiguration> = {}): DecisionState {
  let state = initialState(overrides);
  state = applyEvent(state, createBranchExpandedEvent(state, state.rootBranchId, expansion()));
  return state;
}

function evaluation(score: number): BranchEvaluation {
  return {
    schemaVersion: 1,
    conclusion: {
      summary: `Score ${score}.`,
      recommendation: `Choose score ${score}.`,
      conditions: [],
      caveats: [],
      unresolvedQuestions: [],
    },
    criterionScores: [{ criterionKey: "utility", score, rationale: "Fixture score." }],
    confidence: 1,
    evidence: [],
    assumptions: [],
    caveats: [],
  };
}

test("schemas reject ambiguous criterion and invalid option bounds", () => {
  assert.throws(() => DecisionRequestSchema.parse({
    ...request,
    criteria: [...request.criteria, request.criteria[0]],
  }), /criterion keys must be unique/);
  assert.throws(() => BootstrapConfigurationSchema.parse({
    ...config,
    options: { min: 3, target: 2, max: 4 },
  }), /min <= target <= max/);
});

test("structured extraction keeps the last self-corrected result", () => {
  assert.deepEqual(
    parseStructuredJson('<result>{"version":1}</result> correction <result>{"version":2}</result>'),
    { version: 2 },
  );
});

test("canonical JSON sorts objects but ordered paths remain distinct", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
  const state = expandedRoot();
  const [left, right] = Object.values(state.branches).filter((branch) => branch.parentId !== null);
  assert.ok(left && right);
  assert.notEqual(branchStateHash(left.path), branchStateHash(right.path));
  assert.notEqual(branchStateHash([...left.path, ...right.path]), branchStateHash([...right.path, ...left.path]));
});

test("code materializes exactly one stable child per admitted option and replay is exact", () => {
  const event1 = createRunCreatedEvent("core-replay", request, config);
  let state = applyEvent(undefined, event1);
  const event2 = createBranchExpandedEvent(state, state.rootBranchId, expansion(["a", "b", "c"]));
  state = applyEvent(state, event2);
  assert.equal(Object.keys(state.branches).length, 4);
  assert.equal(state.edges.length, 3);
  assert.equal(new Set(state.edges.map((edge) => edge.optionKey)).size, 3);
  assertGraphInvariants(state);
  assert.deepEqual(replay([event1, event2]), state);
});

test("BFS stays on the shallow layer while DFS selects the deepest branch", () => {
  let state = expandedRoot();
  const children = selectFrontier(state);
  assert.equal(children.length, 2);
  assert.ok(children.every((branch) => branch.depth === 1));
  const first = children[0];
  assert.ok(first);
  state = applyEvent(state, createBranchExpandedEvent(state, first.id, expansion()));
  const bfs = selectFrontier(state, { ...state.config, traversal: "bfs" });
  assert.deepEqual(bfs.map((branch) => branch.depth), [1]);
  const dfs = selectFrontier(state, { ...state.config, traversal: "dfs" });
  assert.deepEqual(dfs.map((branch) => branch.depth), [2]);
});

test("termination never labels a budget or safety stop as coverage", () => {
  const safetyState = expandedRoot({ limits: { ...config.limits, maxQuestions: 1 } });
  assert.equal(checkTermination(safetyState).classification, "partial_safety_limit");
  const budgetState = { ...safetyState, config: { ...safetyState.config, completion: "budget" as const } };
  assert.equal(checkTermination(budgetState).classification, "partial_budget_exhausted");

  let complete = initialState();
  complete = applyEvent(complete, createBranchConcludedEvent(complete, complete.rootBranchId, evaluation(1).conclusion));
  assert.equal(checkTermination(complete).classification, "coverage_complete");

  let stopped = initialState();
  stopped = applyEvent(stopped, createBranchClosedEvent(stopped, stopped.rootBranchId, "safety_limit"));
  assert.equal(checkTermination(stopped).classification, "partial_safety_limit");
});

test("median evaluator aggregation and post-order hindsight choose the correct descendant", () => {
  let state = expandedRoot();
  const children = Object.values(state.branches)
    .filter((branch) => branch.parentId === state.rootBranchId)
    .sort((left, right) => left.createdOrdinal - right.createdOrdinal);
  const left = children[0];
  const right = children[1];
  assert.ok(left && right);
  state = applyEvent(state, createBranchConcludedEvent(state, left.id, evaluation(1).conclusion));
  state = applyEvent(state, createBranchConcludedEvent(state, right.id, evaluation(0.8).conclusion));
  for (const [ordinal, score] of [0, 1, 1].entries()) {
    state = applyEvent(state, createBranchEvaluatedEvent(state, left.id, ordinal, evaluation(score)));
  }
  for (const [ordinal, score] of [0.8, 0.8, 0.8].entries()) {
    state = applyEvent(state, createBranchEvaluatedEvent(state, right.id, ordinal, evaluation(score)));
  }
  const result = backpropagate(state);
  assert.equal(result.rankedLeaves[0]?.branchId, left.id, "median [0,1,1] must beat 0.8");
  assert.equal(result.root?.bestDescendantBranchId, left.id);
  assert.equal(result.root?.leafCount, 2);
  assert.equal(result.root?.worst, 0.8);
  assert.equal(result.root?.mean, 0.9);
});

test("dossier links recommendations to real branches and approval is append-only", () => {
  let state = initialState();
  state = applyEvent(state, createBranchConcludedEvent(state, state.rootBranchId, evaluation(0.9).conclusion));
  state = applyEvent(state, createBranchEvaluatedEvent(state, state.rootBranchId, 0, evaluation(0.9)));
  state = applyEvent(state, createRunCompletedEvent(state, { classification: "coverage_complete", reasons: ["frontier_empty"] }));
  const dossier = assembleDossier(state);
  assert.equal(dossier.recommendation?.branchId, state.rootBranchId);
  assert.equal(dossier.approval.status, "awaiting_human_approval");
  const approvalEvent = createApprovalRecordedEvent(state, {
    decision: "approved",
    decidedBy: "tester",
    notes: "accepted",
    decidedAt: "2026-07-13T00:00:00.000Z",
  });
  state = applyEvent(state, approvalEvent);
  assert.equal(assembleDossier(state).approval.status, "approved");
  assert.throws(() => applyEvent(state, createApprovalRecordedEvent(state, {
    decision: "rejected",
    decidedBy: "tester",
    notes: "second decision",
    decidedAt: "2026-07-13T00:01:00.000Z",
  })), /already been recorded/);
});

test("bounded concurrency commits results in input order, not completion order", async () => {
  const completed: number[] = [];
  const result = await mapConcurrentStable([0, 1, 2], 3, async (value) => {
    await new Promise<void>((resolve) => setTimeout(resolve, (2 - value) * 4));
    completed.push(value);
    return value * 10;
  });
  assert.deepEqual(completed, [2, 1, 0]);
  assert.deepEqual(result, [0, 10, 20]);
});
