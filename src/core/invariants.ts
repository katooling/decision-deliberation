import type { DecisionState } from "../domain/state.js";
import { canonicalJson } from "./canonical-json.js";
import { branchStateHash, ROOT_BRANCH_ID } from "./ids.js";

export function assertGraphInvariants(state: DecisionState): void {
  const root = state.branches[state.rootBranchId];
  if (!root || root.id !== ROOT_BRANCH_ID || root.parentId !== null || root.depth !== 0 || root.path.length !== 0) throw new Error("Invalid root branch");
  const ordinals = new Set<number>();
  for (const branch of Object.values(state.branches)) {
    if (ordinals.has(branch.createdOrdinal)) throw new Error(`Duplicate createdOrdinal ${branch.createdOrdinal}`);
    ordinals.add(branch.createdOrdinal);
    if (branch.path.length !== branch.depth) throw new Error(`Path/depth mismatch on ${branch.id}`);
    if (branch.branchStateHash !== branchStateHash(branch.path)) throw new Error(`State hash mismatch on ${branch.id}`);
    if (branch.parentId === null) continue;
    const parent = state.branches[branch.parentId];
    if (!parent) throw new Error(`Missing parent of ${branch.id}`);
    if (branch.depth !== parent.depth + 1) throw new Error(`Depth mismatch on ${branch.id}`);
    if (canonicalJson(branch.path.slice(0, -1)) !== canonicalJson(parent.path)) throw new Error(`Ordered path prefix mismatch on ${branch.id}`);
  }
  const edgeIds = new Set<string>();
  for (const edge of state.edges) {
    if (edgeIds.has(edge.id)) throw new Error(`Duplicate edge ${edge.id}`);
    edgeIds.add(edge.id);
    const child = state.branches[edge.childBranchId];
    if (!state.branches[edge.parentBranchId] || !child || child.parentId !== edge.parentBranchId) throw new Error(`Invalid edge ${edge.id}`);
  }
  for (const expansion of Object.values(state.expansions)) {
    const edges = state.edges.filter((edge) => edge.questionId === expansion.questionId).sort((a, b) => a.ordinal - b.ordinal);
    if (canonicalJson(edges.map((edge) => edge.childBranchId)) !== canonicalJson(expansion.childBranchIds)) throw new Error(`Expansion child order mismatch: ${expansion.id}`);
    if (expansion.question.options.length !== expansion.childBranchIds.length) throw new Error(`Expansion option count mismatch: ${expansion.id}`);
  }
}

export const assertDecisionStateInvariants = assertGraphInvariants;
