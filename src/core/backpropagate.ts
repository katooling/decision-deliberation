import type { DecisionState } from "../domain/state.js";

export interface LeafScore {
  branchId: string;
  rawScore: number;
  adjustedScore: number;
  confidence: number;
  evaluatorCount: number;
}

export interface SubtreeScore {
  branchId: string;
  leafCount: number;
  best: number;
  mean: number;
  worst: number;
  bestDescendantBranchId: string;
}

export interface BackpropagationResult {
  leafScores: LeafScore[];
  rankedLeaves: LeafScore[];
  subtrees: Record<string, SubtreeScore>;
  root: SubtreeScore | null;
  unscoredLeafBranchIds: string[];
}

function scoreLeaf(state: DecisionState, branchId: string): LeafScore | null {
  const branch = state.branches[branchId];
  if (!branch || branch.evaluations.length === 0) return null;
  const weights = new Map(state.request.criteria.map((criterion) => [criterion.key, criterion.weight]));
  const weightTotal = state.request.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const median = (values: number[]): number => {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    const value = sorted[middle];
    if (value === undefined) throw new Error("Cannot calculate the median of an empty set");
    if (sorted.length % 2 === 1) return value;
    const previous = sorted[middle - 1];
    if (previous === undefined) throw new Error("Median pair is incomplete");
    return (previous + value) / 2;
  };
  const evaluationsByCriterion = new Map<string, number[]>();
  for (const recorded of branch.evaluations) {
    const scores = new Map(recorded.evaluation.criterionScores.map((item) => [item.criterionKey, item.score]));
    if (scores.size !== recorded.evaluation.criterionScores.length) throw new Error(`Duplicate criterion score on ${branchId}`);
    for (const key of scores.keys()) if (!weights.has(key)) throw new Error(`Unknown criterion ${key} on ${branchId}`);
    for (const criterion of state.request.criteria) {
      const score = scores.get(criterion.key);
      if (score === undefined) {
        throw new Error(`Missing criterion ${criterion.key} on ${branchId}`);
      }
      evaluationsByCriterion.set(criterion.key, [
        ...(evaluationsByCriterion.get(criterion.key) ?? []),
        score,
      ]);
    }
  }
  const rawScore = state.request.criteria.reduce(
    (sum, criterion) =>
      sum + median(evaluationsByCriterion.get(criterion.key) ?? []) * criterion.weight,
    0,
  ) / weightTotal;
  const medianConfidence = median(
    branch.evaluations.map((recorded) => recorded.evaluation.confidence),
  );
  return {
    branchId,
    rawScore,
    adjustedScore: rawScore * (1 - state.config.confidencePenalty * (1 - medianConfidence)),
    confidence: medianConfidence,
    evaluatorCount: branch.evaluations.length,
  };
}

export function backpropagate(state: DecisionState): BackpropagationResult {
  const childIds = new Set(state.edges.map((edge) => edge.childBranchId));
  const parentIds = new Set(state.edges.map((edge) => edge.parentBranchId));
  const leaves = Object.values(state.branches).filter((branch) => !parentIds.has(branch.id) && branch.status !== "failed");
  const leafScores = leaves.map((branch) => scoreLeaf(state, branch.id)).filter((score): score is LeafScore => score !== null);
  const scoreById = new Map(leafScores.map((score) => [score.branchId, score]));
  const children = new Map<string, string[]>();
  for (const edge of [...state.edges].sort((a, b) => a.ordinal - b.ordinal)) {
    children.set(edge.parentBranchId, [...(children.get(edge.parentBranchId) ?? []), edge.childBranchId]);
  }
  const subtrees: Record<string, SubtreeScore> = {};
  for (const branch of Object.values(state.branches).sort((a, b) => b.depth - a.depth || b.createdOrdinal - a.createdOrdinal)) {
    const leaf = scoreById.get(branch.id);
    if (leaf) {
      subtrees[branch.id] = { branchId: branch.id, leafCount: 1, best: leaf.adjustedScore, mean: leaf.adjustedScore, worst: leaf.adjustedScore, bestDescendantBranchId: branch.id };
      continue;
    }
    const descendants = (children.get(branch.id) ?? []).map((id) => subtrees[id]).filter((score): score is SubtreeScore => score !== undefined);
    if (descendants.length === 0) continue;
    const bestChild = descendants.reduce((best, item) => item.best > best.best ? item : best);
    const leafCount = descendants.reduce((sum, item) => sum + item.leafCount, 0);
    subtrees[branch.id] = {
      branchId: branch.id,
      leafCount,
      best: bestChild.best,
      mean: descendants.reduce((sum, item) => sum + item.mean * item.leafCount, 0) / leafCount,
      worst: Math.min(...descendants.map((item) => item.worst)),
      bestDescendantBranchId: bestChild.bestDescendantBranchId,
    };
  }
  const rankedLeaves = [...leafScores].sort((a, b) => b.adjustedScore - a.adjustedScore || b.rawScore - a.rawScore || (state.branches[a.branchId]?.createdOrdinal ?? 0) - (state.branches[b.branchId]?.createdOrdinal ?? 0));
  return {
    leafScores,
    rankedLeaves,
    subtrees,
    root: subtrees[state.rootBranchId] ?? null,
    unscoredLeafBranchIds: leaves.filter((branch) => !scoreById.has(branch.id)).map((branch) => branch.id),
  };
}

export const aggregateScores = backpropagate;
