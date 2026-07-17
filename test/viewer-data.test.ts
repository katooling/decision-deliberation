import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson } from "../src/core/canonical-json.js";
import { assembleDossier, type DecisionDossier } from "../src/core/dossier.js";
import type { DecisionState } from "../src/domain/state.js";
import { deriveViewerBundle } from "../src/viewer/bundle.js";
import { layoutHierarchical, layoutRadial } from "../src/viewer/layout.js";

const demoDirectory = join(process.cwd(), "work", "demo-runs-2", "demo");

function loadDemo(): { state: DecisionState; dossier: DecisionDossier } {
  return {
    state: JSON.parse(readFileSync(join(demoDirectory, "graph.json"), "utf8")) as DecisionState,
    dossier: JSON.parse(readFileSync(join(demoDirectory, "dossier.json"), "utf8")) as DecisionDossier,
  };
}

function failedAState(source: DecisionState): DecisionState {
  const state = structuredClone(source);
  const branchA = Object.values(state.branches).find(
    (branch) => branch.depth === 1 && branch.selectedBy?.optionKey === "a",
  );
  assert.ok(branchA);
  const removedIds = new Set(
    Object.values(state.branches)
      .filter((branch) => branch.parentId === branchA.id)
      .map((branch) => branch.id),
  );
  for (const id of removedIds) delete state.branches[id];
  for (const [id, expansion] of Object.entries(state.expansions)) {
    if (expansion.branchId === branchA.id) delete state.expansions[id];
  }
  state.edges = state.edges.filter(
    (edge) => edge.parentBranchId !== branchA.id && !removedIds.has(edge.childBranchId),
  );
  state.branches[branchA.id] = {
    ...branchA,
    status: "failed",
    expandedByQuestionId: null,
    terminalReason: "failed",
    conclusion: null,
    evaluations: [],
    failure: "question proposer(s) failed after two attempts",
  };
  state.completion = {
    classification: "partial_failure",
    reasons: ["failed_branches"],
  };
  state.eventsApplied += 1;
  state.lastEventId = "event_partial_failure_fixture";
  return state;
}

test("viewer projects the demo tree and distinguishes local advice from hindsight", () => {
  const { state, dossier } = loadDemo();
  const bundle = deriveViewerBundle(state, dossier);

  assert.equal(bundle.summary.branchCount, 13);
  assert.equal(bundle.summary.edgeCount, 12);
  assert.equal(bundle.summary.questionCount, 4);
  assert.equal(bundle.nodes.filter((node) => node.kind === "question").length, 4);
  assert.equal(bundle.nodes.filter((node) => node.kind === "conclusion").length, 9);
  assert.equal(bundle.summary.winningAdjustedScore, 0.98);

  const root = bundle.nodes.find((node) => node.flags.isRoot);
  assert.ok(root?.question);
  assert.equal(root.question.localRecommendation.optionKey, "a");
  assert.equal(root.question.hindsight.optionKey, "c");
  assert.equal(root.question.hindsight.changedLocalRecommendation, true);

  const cBranch = bundle.nodes.find((node) => node.pathKey === "primary_strategy=c");
  assert.ok(cBranch?.question);
  assert.equal(cBranch.question.localRecommendation.optionKey, "d");
  assert.equal(cBranch.question.hindsight.optionKey, "f");
  const winner = bundle.nodes.find((node) => node.flags.isWinningLeaf);
  assert.equal(winner?.pathKey, "primary_strategy=c/follow_up_mode=f");
  assert.deepEqual(
    bundle.nodes.filter((node) => node.flags.isOnWinningPath).map((node) => node.pathKey),
    ["", "primary_strategy=c", "primary_strategy=c/follow_up_mode=f"],
  );

  const rootA = bundle.edges.find((edge) => edge.source === root.id && edge.optionKey === "a");
  const rootC = bundle.edges.find((edge) => edge.source === root.id && edge.optionKey === "c");
  assert.equal(rootA?.flags.isLocalRecommendation, true);
  assert.equal(rootA?.flags.isHindsightChoice, false);
  assert.equal(rootC?.flags.isLocalRecommendation, false);
  assert.equal(rootC?.flags.isHindsightChoice, true);
  assert.equal(rootC?.flags.isOnWinningPath, true);
  assert.equal(root.score.subtree?.leafCount, 9);
  assert.equal(root.score.subtree?.best, 0.98);
  assert.equal(root.score.subtree?.mean, 0.7122222222222222);
  assert.equal(root.score.subtree?.worst, 0.5700000000000001);
});

test("same semantic question under distinct histories remains distinct", () => {
  const { state, dossier } = loadDemo();
  const bundle = deriveViewerBundle(state, dossier);
  const followUps = bundle.nodes.filter(
    (node) => node.question?.semanticKey === "follow_up_mode",
  );
  assert.equal(followUps.length, 3);
  assert.equal(new Set(followUps.map((node) => node.id)).size, 3);
  assert.deepEqual(followUps.map((node) => node.pathKey), [
    "primary_strategy=a",
    "primary_strategy=b",
    "primary_strategy=c",
  ]);
  assert.equal(
    bundle.relations.filter((relation) => relation.semanticKey === "follow_up_mode").length,
    2,
    "semantic peers use a non-canonical chain, not a clique or merge",
  );
  assert.ok(bundle.relations.every((relation) => relation.canonical === false));
});

test("viewer conversion is canonical despite record and edge insertion order", () => {
  const { state, dossier } = loadDemo();
  const shuffled = structuredClone(state);
  shuffled.branches = Object.fromEntries(Object.entries(shuffled.branches).reverse());
  shuffled.expansions = Object.fromEntries(Object.entries(shuffled.expansions).reverse());
  shuffled.edges.reverse();
  assert.equal(
    canonicalJson(deriveViewerBundle(state, dossier)),
    canonicalJson(deriveViewerBundle(shuffled, dossier)),
  );
});

test("failed branches remain visible and unknown scores are never rendered as zero", () => {
  const { state } = loadDemo();
  const partial = failedAState(state);
  const bundle = deriveViewerBundle(partial, assembleDossier(partial));
  const failed = bundle.nodes.find((node) => node.pathKey === "primary_strategy=a");
  assert.equal(bundle.run.completion, "partial_failure");
  assert.equal(bundle.summary.failedBranches, 1);
  assert.equal(bundle.summary.branchCount, 10);
  assert.equal(failed?.kind, "failed");
  assert.equal(failed?.failure, "question proposer(s) failed after two attempts");
  assert.equal(failed?.score.state, "unscored");
  assert.equal(failed?.score.absentReason, "failed");
  assert.equal(failed?.score.adjusted, null);
  assert.notEqual(failed?.score.adjusted, 0);
  assert.equal(failed?.flags.isOnWinningPath, false);
});

test("hierarchical and radial layouts are deterministic, focusable, and overlap-free", () => {
  const { state, dossier } = loadDemo();
  const bundle = deriveViewerBundle(state, dossier);
  const tree = layoutHierarchical(bundle);
  assert.equal(tree.nodes.length, 13);
  assert.equal(tree.edges.length, 12);

  for (const [index, left] of tree.nodes.entries()) {
    for (const right of tree.nodes.slice(index + 1)) {
      if (left.relativeDepth !== right.relativeDepth) continue;
      assert.ok(
        Math.abs(left.x - right.x) >= (left.width + right.width) / 2,
        `${left.id} overlaps ${right.id}`,
      );
    }
  }

  const aBranch = bundle.nodes.find((node) => node.pathKey === "primary_strategy=a");
  const cBranch = bundle.nodes.find((node) => node.pathKey === "primary_strategy=c");
  assert.ok(aBranch && cBranch);
  const collapsed = layoutHierarchical(bundle, { collapsedIds: new Set([aBranch.id]) });
  assert.equal(collapsed.nodes.length, 10);
  assert.equal(collapsed.hiddenDescendantCounts[aBranch.id], 3);
  const focused = layoutHierarchical(bundle, { focusId: cBranch.id });
  assert.equal(focused.nodes.length, 4);
  assert.equal(focused.nodes[0]?.id, cBranch.id);
  assert.equal(focused.nodes[0]?.relativeDepth, 0);

  const radial = layoutRadial(bundle);
  assert.deepEqual(radial, layoutRadial(bundle));
  assert.equal(radial.nodes.length, 13);
  assert.ok(
    radial.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)),
  );
});
