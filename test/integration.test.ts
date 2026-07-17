import assert from "node:assert/strict";
import test from "node:test";

import type { AgentRequest } from "../src/agents/provider.js";
import type { DecisionDossier } from "../src/core/dossier.js";
import type {
  BootstrapConfiguration,
  BranchConclusion,
  CandidateOption,
  DecisionRequest,
  FinalResolution,
} from "../src/domain/schemas.js";
import type { BranchNode } from "../src/domain/state.js";
import {
  DecisionEngine,
  MemoryRunStore,
  ScriptedProvider,
  assembleDossier,
} from "../src/index.js";

const decisionRequest: DecisionRequest = {
  schemaVersion: 1,
  title: "Choose a two-stage design",
  decisionStatement: "Which complete path produces the strongest outcome?",
  context: "The locally attractive root option is intentionally a trap.",
  scope: {
    inScope: ["Every admitted A/B/C then D/E/F path"],
    outOfScope: ["Automatic execution"],
    constraints: ["Use one shared outcome criterion"],
  },
  criteria: [
    {
      key: "outcome",
      label: "Outcome quality",
      description: "How strong the complete path is after hindsight.",
      weight: 1,
      zeroAnchor: "No useful outcome",
      oneAnchor: "Best attainable outcome",
    },
  ],
};

const coverageConfig: BootstrapConfiguration = {
  schemaVersion: 1,
  completion: "coverage",
  traversal: "bfs",
  questionPipeline: {
    proposerCount: 1,
    reviewerCount: 1,
    synthesizerCount: 1,
  },
  options: { min: 2, target: 3, max: 3 },
  limits: {
    maxDepth: 3,
    maxNodes: 100,
    maxQuestions: 100,
    maxAgentCalls: 200,
  },
  concurrency: 3,
  maxAttemptsPerCall: 2,
  evaluatorCount: 1,
  confidencePenalty: 0,
};

const leafScores: Readonly<Record<string, number>> = {
  ad: 0.4,
  ae: 0.5,
  af: 0.3,
  bd: 0.6,
  be: 0.95,
  bf: 0.55,
  cd: 0.7,
  ce: 0.65,
  cf: 0.8,
};

function option(key: string): CandidateOption {
  return {
    key,
    label: key.toUpperCase(),
    description: `Commit to option ${key.toUpperCase()}.`,
    expectedConsequences: [`The path now includes ${key.toUpperCase()}.`],
    assumptions: [`Option ${key.toUpperCase()} remains feasible.`],
    tradeoffs: [`Choosing ${key.toUpperCase()} excludes its siblings.`],
  };
}

function expansion(
  semanticKey: string,
  text: string,
  optionKeys: readonly string[],
  recommendation: string,
): FinalResolution {
  return {
    type: "expand",
    question: {
      semanticKey,
      text,
      rationale: "Expand every atomic, mutually exclusive option.",
      resolves: [semanticKey],
      options: optionKeys.map(option),
      recommendation: {
        optionKey: recommendation,
        reason: `${recommendation.toUpperCase()} looks strongest using only local information.`,
        confidence: 0.8,
      },
      coverageRationale: "The fixture declares these as the complete admitted options.",
      atomicityRationale: "Each option makes exactly one commitment.",
      exclusivityRationale: "Only one sibling can be selected on a branch.",
    },
  };
}

function pathKey(branch: BranchNode): string {
  return branch.path.map((step) => step.optionKey).join("");
}

function conclusion(branch: BranchNode): BranchConclusion {
  const path = pathKey(branch).toUpperCase() || "ROOT";
  return {
    summary: `${path} is fully resolved.`,
    recommendation: `Choose ${path}.`,
    conditions: ["The declared fixture scope remains unchanged."],
    caveats: ["This is deterministic fixture evidence."],
    unresolvedQuestions: [],
  };
}

function resolutionFor(branch: BranchNode): FinalResolution {
  if (branch.depth === 0) {
    return expansion("root_choice", "Which root option?", ["a", "b", "c"], "a");
  }
  if (branch.depth === 1) {
    return expansion("second_choice", "Which follow-up option?", ["d", "e", "f"], "d");
  }
  return { type: "conclude", conclusion: conclusion(branch) };
}

function branchFrom(request: AgentRequest): BranchNode {
  const input = request.input as {
    branch: BranchNode | { branch: BranchNode };
  };
  if (request.role === "branch-evaluator") return input.branch as BranchNode;
  return (input.branch as { branch: BranchNode }).branch;
}

function wrappedResolution(branch: BranchNode): string {
  return JSON.stringify({ schemaVersion: 1, resolution: resolutionFor(branch) });
}

function coverageReview(): string {
  return JSON.stringify({
    schemaVersion: 1,
    findings: {
      missingAngles: [],
      overlaps: [],
      atomicityIssues: [],
      exclusivityIssues: [],
      pathContextRisks: [],
    },
    synthesisInstructions: ["Preserve all declared fixture options."],
    preferredProposalIndexes: [0],
  });
}

function branchEvaluation(branch: BranchNode): string {
  const key = pathKey(branch);
  const score = leafScores[key] ?? (branch.depth === 0 ? 0.5 : 0.1);
  return JSON.stringify({
    schemaVersion: 1,
    conclusion: branch.conclusion ?? conclusion(branch),
    criterionScores: [
      {
        criterionKey: "outcome",
        score,
        rationale: `${key.toUpperCase() || "ROOT"} has fixture utility ${score}.`,
      },
    ],
    confidence: 0.9,
    evidence: [
      {
        claim: `${key.toUpperCase() || "ROOT"} was evaluated as a complete path.`,
        source: "deterministic integration fixture",
        strength: "strong",
      },
    ],
    assumptions: ["Fixture utilities are the comparison truth."],
    caveats: ["Synthetic test scenario."],
  });
}

interface ProviderFixtureOptions {
  reverseCompletion?: boolean;
  invalidSynthesisOnce?: boolean;
  permanentlyMalformedPath?: string;
}

function reverseDelay(branch: BranchNode): number {
  const key = branch.path.at(-1)?.optionKey;
  return ({ a: 9, b: 6, c: 3, d: 9, e: 6, f: 3 } as const)[
    key as "a" | "b" | "c" | "d" | "e" | "f"
  ] ?? 0;
}

function makeProvider(options: ProviderFixtureOptions = {}) {
  return new ScriptedProvider(async (request: AgentRequest) => {
    const branch = branchFrom(request);
    if (options.reverseCompletion && branch.depth > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, reverseDelay(branch)));
    }

    if (
      options.permanentlyMalformedPath === pathKey(branch) &&
      request.role === "question-proposer"
    ) {
      return "permanently malformed";
    }
    if (
      options.invalidSynthesisOnce &&
      request.role === "question-synthesizer" &&
      branch.depth === 0 &&
      request.attempt === 1
    ) {
      return "invalid on the first attempt";
    }

    switch (request.role) {
      case "question-proposer":
      case "question-synthesizer":
        return wrappedResolution(branch);
      case "coverage-reviewer":
        return coverageReview();
      case "branch-evaluator":
        return branchEvaluation(branch);
      case "baseline-designer":
        throw new Error("The DecisionEngine must not invoke a baseline designer.");
    }
  });
}

function branchAtPath(branches: Record<string, BranchNode>, path: string): BranchNode {
  const branch = Object.values(branches).find((candidate) => pathKey(candidate) === path);
  assert.ok(branch, `Expected branch at path ${path}`);
  return branch;
}

function withoutRunId(dossier: DecisionDossier): Omit<DecisionDossier, "runId"> {
  const { runId: _runId, ...logicalDossier } = dossier;
  return logicalDossier;
}

test("exhaustive two-level deliberation uses hindsight and replays exactly despite reversed completion", async () => {
  const store = new MemoryRunStore();
  const provider = makeProvider();
  const engine = new DecisionEngine({ store, provider });
  const dossier = await engine.createAndRun(
    decisionRequest,
    coverageConfig,
    "integration-normal",
  );
  const state = await engine.replay("integration-normal");

  const leaves = Object.values(state.branches).filter(
    (branch) => branch.status === "terminal",
  );
  assert.equal(leaves.length, 9);
  assert.equal(Object.keys(state.branches).length, 13);
  assert.equal(Object.keys(state.expansions).length, 4);
  assert.equal(state.edges.length, 12);
  assert.equal(
    provider.calls.filter((call) => call.role === "question-synthesizer").length,
    13,
    "root + three first-level branches + nine concluded leaves",
  );
  assert.equal(provider.calls.length, 48);
  assert.ok(provider.calls.every((call) => String(call.role) !== "answer-agent"));
  assert.deepEqual(
    [...new Set(provider.calls.map((call) => call.role))].sort(),
    ["branch-evaluator", "coverage-reviewer", "question-proposer", "question-synthesizer"],
  );

  assert.equal(state.completion?.classification, "coverage_complete");
  assert.equal(dossier.completeness, "coverage_complete");
  assert.equal(dossier.stats.evaluatedLeaves, 9);
  assert.ok(
    Object.values(state.branches).every(
      (branch) => branch.status === "expanded" || branch.status === "terminal",
    ),
  );

  const rootExpansion = Object.values(state.expansions).find(
    (item) => item.branchId === state.rootBranchId,
  );
  assert.ok(rootExpansion);
  assert.equal(rootExpansion.question.recommendation.optionKey, "a");
  assert.ok(dossier.recommendation);
  assert.deepEqual(
    dossier.recommendation.path.map((step) => step.optionKey),
    ["b", "e"],
  );
  assert.equal(dossier.aggregation.root?.leafCount, 9);
  assert.equal(
    dossier.aggregation.root?.bestDescendantBranchId,
    dossier.recommendation.branchId,
  );

  const ad = branchAtPath(state.branches, "ad");
  const bd = branchAtPath(state.branches, "bd");
  assert.equal(ad.path.at(-1)?.questionSemanticKey, bd.path.at(-1)?.questionSemanticKey);
  assert.equal(ad.path.at(-1)?.questionText, bd.path.at(-1)?.questionText);
  assert.equal(ad.path.at(-1)?.optionKey, bd.path.at(-1)?.optionKey);
  assert.notEqual(ad.id, bd.id);
  assert.notEqual(ad.branchStateHash, bd.branchStateHash);
  assert.equal(
    new Set(Object.values(state.branches).map((branch) => branch.branchStateHash)).size,
    13,
  );

  const callCountBeforeReplay = provider.calls.length;
  const replayed = await engine.replay("integration-normal");
  assert.equal(provider.calls.length, callCountBeforeReplay, "replay must not invoke an agent");
  assert.deepEqual(replayed, await store.readSnapshot("integration-normal"));
  assert.deepEqual(assembleDossier(replayed), dossier);
  assert.deepEqual(await store.readDossier("integration-normal"), dossier);

  const delayedStore = new MemoryRunStore();
  const delayedProvider = makeProvider({ reverseCompletion: true });
  const delayedEngine = new DecisionEngine({
    store: delayedStore,
    provider: delayedProvider,
  });
  const delayedDossier = await delayedEngine.createAndRun(
    decisionRequest,
    coverageConfig,
    "integration-reversed",
  );

  const firstLevelReviewerOrder = delayedProvider.calls
    .filter((call) => {
      if (call.role !== "coverage-reviewer") return false;
      return branchFrom(call).depth === 1;
    })
    .map((call) => pathKey(branchFrom(call)));
  assert.deepEqual(firstLevelReviewerOrder, ["c", "b", "a"]);
  assert.deepEqual(withoutRunId(delayedDossier), withoutRunId(dossier));
});

test("an invalid first synthesis is retried with validation feedback and then completes", async () => {
  const store = new MemoryRunStore();
  const provider = makeProvider({ invalidSynthesisOnce: true });
  const engine = new DecisionEngine({ store, provider });
  const dossier = await engine.createAndRun(
    decisionRequest,
    coverageConfig,
    "integration-retry",
  );
  const state = await engine.replay("integration-retry");

  const rootSynthesisCalls = provider.calls.filter(
    (call) =>
      call.role === "question-synthesizer" && branchFrom(call).depth === 0,
  );
  assert.deepEqual(
    rootSynthesisCalls.map((call) => call.attempt),
    [1, 2],
  );
  assert.deepEqual(rootSynthesisCalls[0]?.validationErrors, []);
  assert.match(
    rootSynthesisCalls[1]?.validationErrors[0] ?? "",
    /did not contain valid raw or tagged JSON/,
  );
  assert.equal(state.usage.retries, 1);
  assert.equal(state.completion?.classification, "coverage_complete");
  assert.equal(dossier.completeness, "coverage_complete");
  assert.equal(dossier.stats.evaluatedLeaves, 9);
});

test("a permanently malformed branch is preserved as a partial failure", async () => {
  const store = new MemoryRunStore();
  const provider = makeProvider({ permanentlyMalformedPath: "a" });
  const engine = new DecisionEngine({ store, provider });
  const dossier = await engine.createAndRun(
    decisionRequest,
    coverageConfig,
    "integration-malformed",
  );
  const state = await engine.replay("integration-malformed");
  const failedBranch = branchAtPath(state.branches, "a");

  assert.equal(failedBranch.status, "failed");
  assert.equal(failedBranch.terminalReason, "failed");
  assert.match(failedBranch.failure ?? "", /question proposer\(s\) failed/);
  assert.equal(
    provider.calls.filter(
      (call) => call.role === "question-proposer" && pathKey(branchFrom(call)) === "a",
    ).length,
    2,
  );
  assert.equal(
    Object.values(state.branches).filter((branch) => branch.status === "terminal").length,
    6,
  );
  assert.equal(state.completion?.classification, "partial_failure");
  assert.ok(state.completion.reasons.includes("failed_branches"));
  assert.equal(dossier.completeness, "partial_failure");
  assert.equal(dossier.stats.evaluatedLeaves, 6);
  assert.ok(dossier.recommendation);
  assert.deepEqual(
    dossier.recommendation.path.map((step) => step.optionKey),
    ["b", "e"],
  );
});

test("a transactional expansion that would cross maxNodes stops as partial safety evidence", async () => {
  const store = new MemoryRunStore();
  const provider = makeProvider();
  const engine = new DecisionEngine({ store, provider });
  const constrainedConfig: BootstrapConfiguration = {
    ...coverageConfig,
    limits: { ...coverageConfig.limits, maxNodes: 3 },
  };
  const dossier = await engine.createAndRun(
    decisionRequest,
    constrainedConfig,
    "integration-node-safety",
  );
  const state = await engine.replay("integration-node-safety");

  assert.equal(Object.keys(state.branches).length, 1, "partial expansion is forbidden");
  assert.equal(state.edges.length, 0);
  assert.equal(state.branches[state.rootBranchId]?.terminalReason, "safety_limit");
  assert.equal(state.completion?.classification, "partial_safety_limit");
  assert.equal(dossier.completeness, "partial_safety_limit");
});
