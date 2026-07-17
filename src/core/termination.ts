import type { BootstrapConfiguration } from "../domain/schemas.js";
import type { DecisionState, RunCompletionClassification, UsageCounters } from "../domain/state.js";
import { depthLimitedFrontier, eligibleFrontier } from "./frontier.js";

export interface TerminationDecision {
  terminate: boolean;
  classification: RunCompletionClassification | null;
  reasons: string[];
  branchesToClose: string[];
}

export function checkTermination(
  state: DecisionState,
  config: BootstrapConfiguration = state.config,
  usage: UsageCounters = state.usage,
): TerminationDecision {
  if (state.completion) {
    return { terminate: true, classification: state.completion.classification, reasons: [...state.completion.reasons], branchesToClose: [] };
  }
  const frontier = Object.values(state.branches).filter((branch) => branch.status === "frontier");
  const expandable = eligibleFrontier(state, config);
  const depthLimited = depthLimitedFrontier(state, config);
  const safetyStopped = Object.values(state.branches).filter(
    (branch) =>
      branch.status === "terminal" &&
      (branch.terminalReason === "safety_limit" || branch.terminalReason === "depth_limit"),
  );
  const budgetStopped = Object.values(state.branches).filter(
    (branch) => branch.status === "terminal" && branch.terminalReason === "budget_limit",
  );
  if (safetyStopped.length > 0 || budgetStopped.length > 0) {
    const budget = budgetStopped.length > 0 && safetyStopped.length === 0;
    return {
      terminate: true,
      classification: budget ? "partial_budget_exhausted" : "partial_safety_limit",
      reasons: [budget ? "budget_stopped_branch" : "safety_stopped_branch"],
      branchesToClose: frontier.map((branch) => branch.id),
    };
  }
  const reasons: string[] = [];
  if (Object.keys(state.branches).length >= config.limits.maxNodes) reasons.push("max_nodes");
  if (usage.questions >= config.limits.maxQuestions) reasons.push("max_questions");
  if (usage.agentCalls >= config.limits.maxAgentCalls) reasons.push("max_agent_calls");
  if (config.limits.maxWallTimeMs !== undefined && usage.wallTimeMs >= config.limits.maxWallTimeMs) reasons.push("max_wall_time");

  if (reasons.length > 0) {
    return {
      terminate: true,
      classification: config.completion === "budget" ? "partial_budget_exhausted" : "partial_safety_limit",
      reasons,
      branchesToClose: frontier.map((branch) => branch.id),
    };
  }
  if (expandable.length === 0 && depthLimited.length > 0) {
    return {
      terminate: true,
      classification: config.completion === "budget" ? "partial_budget_exhausted" : "partial_safety_limit",
      reasons: ["max_depth"],
      branchesToClose: depthLimited.map((branch) => branch.id),
    };
  }
  if (Object.values(state.branches).some((branch) => branch.status === "expanding")) {
    return { terminate: false, classification: null, reasons: [], branchesToClose: [] };
  }
  if (frontier.length === 0) {
    const failed = Object.values(state.branches).some((branch) => branch.status === "failed");
    return {
      terminate: true,
      classification: failed ? "partial_failure" : "coverage_complete",
      reasons: [failed ? "failed_branches" : "frontier_empty"],
      branchesToClose: [],
    };
  }
  return { terminate: false, classification: null, reasons: [], branchesToClose: [] };
}

export const classifyTermination = checkTermination;
