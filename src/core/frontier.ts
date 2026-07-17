import type { BootstrapConfiguration } from "../domain/schemas.js";
import type { BranchNode, DecisionState } from "../domain/state.js";

export function isEligibleFrontierBranch(
  branch: BranchNode,
  config: BootstrapConfiguration,
): boolean {
  return branch.status === "frontier" && branch.depth < config.limits.maxDepth;
}

export function eligibleFrontier(
  state: DecisionState,
  config: BootstrapConfiguration = state.config,
): BranchNode[] {
  return Object.values(state.branches).filter((branch) =>
    isEligibleFrontierBranch(branch, config),
  );
}

/**
 * Select a stable traversal batch. BFS never crosses a depth layer; DFS takes
 * the newest deepest branches first. A caller may lower the deterministic
 * concurrency cap for tests or execution environments.
 */
export function selectFrontier(
  state: DecisionState,
  config: BootstrapConfiguration = state.config,
  limit = config.traversal === "dfs" ? 1 : config.concurrency,
): BranchNode[] {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Frontier limit must be positive");
  const candidates = eligibleFrontier(state, config);
  if (candidates.length === 0) return [];

  if (config.traversal === "bfs") {
    const depth = Math.min(...candidates.map((branch) => branch.depth));
    return candidates
      .filter((branch) => branch.depth === depth)
      .sort((left, right) => left.createdOrdinal - right.createdOrdinal || left.id.localeCompare(right.id))
      .slice(0, limit);
  }

  return candidates
    .sort(
      (left, right) =>
        right.depth - left.depth ||
        right.createdOrdinal - left.createdOrdinal ||
        right.id.localeCompare(left.id),
    )
    .slice(0, limit);
}

export function depthLimitedFrontier(
  state: DecisionState,
  config: BootstrapConfiguration = state.config,
): BranchNode[] {
  return Object.values(state.branches)
    .filter(
      (branch) => branch.status === "frontier" && branch.depth >= config.limits.maxDepth,
    )
    .sort((left, right) => left.createdOrdinal - right.createdOrdinal);
}
