import { FinalResolutionSchema } from "../domain/schemas.js";
import type {
  BranchEdge,
  BranchNode,
  DecisionState,
  DecisionStep,
  ExpansionValidationResult,
  MaterializedExpansion,
} from "../domain/state.js";
import { createDecisionEvent, type DecisionEvent } from "./events.js";
import {
  branchStateHash,
  createChildBranchId,
  createEdgeId,
  createExpansionId,
  createQuestionId,
} from "./ids.js";

export class ExpansionValidationError extends Error {
  readonly violations: string[];

  constructor(violations: string[]) {
    super(`Invalid branch expansion: ${violations.join("; ")}`);
    this.name = "ExpansionValidationError";
    this.violations = violations;
  }
}

export function validateExpansion(
  state: DecisionState,
  resolution: unknown,
): ExpansionValidationResult {
  const parsed = FinalResolutionSchema.safeParse(resolution);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "resolution"}: ${issue.message}`,
      ),
      options: [],
    };
  }
  if (parsed.data.type !== "expand") {
    return { valid: false, errors: ["resolution must have type expand"], options: [] };
  }

  const { question } = parsed.data;
  const errors: string[] = [];
  const keys = question.options.map((option) => option.key);
  if (new Set(keys).size !== keys.length) errors.push("option keys must be unique");
  if (question.options.length < state.config.options.min) {
    errors.push(`expected at least ${state.config.options.min} options`);
  }
  if (question.options.length > state.config.options.max) {
    errors.push(`expected at most ${state.config.options.max} options`);
  }
  if (!keys.includes(question.recommendation.optionKey)) {
    errors.push("recommendation.optionKey must identify one of the options");
  }
  return { valid: errors.length === 0, errors, options: question.options };
}

function requireExpandableBranch(state: DecisionState, branchId: string): BranchNode {
  const branch = state.branches[branchId];
  if (!branch) throw new Error(`Unknown branch: ${branchId}`);
  if (state.completion) throw new Error("Cannot expand a completed run");
  if (branch.status !== "frontier" && branch.status !== "expanding") {
    throw new Error(`Branch ${branchId} cannot be expanded from ${branch.status}`);
  }
  if (branch.depth >= state.config.limits.maxDepth) {
    throw new Error(`Branch ${branchId} reached maxDepth ${state.config.limits.maxDepth}`);
  }
  return branch;
}

/** Materialize exactly one child branch per option, retaining option order. */
export function materializeExpansion(
  state: DecisionState,
  branchId: string,
  resolution: unknown,
): MaterializedExpansion {
  const branch = requireExpandableBranch(state, branchId);
  const validation = validateExpansion(state, resolution);
  if (!validation.valid) throw new ExpansionValidationError(validation.errors);
  const parsed = FinalResolutionSchema.parse(resolution);
  if (parsed.type !== "expand") throw new ExpansionValidationError(["resolution must expand"]);

  if (Object.keys(state.branches).length + parsed.question.options.length > state.config.limits.maxNodes) {
    throw new ExpansionValidationError([
      "expanding every admitted option would exceed maxNodes; partial expansion is forbidden",
    ]);
  }

  const questionId = createQuestionId(branch.id, parsed.question);
  const expansionId = createExpansionId(questionId);
  const childBranches: BranchNode[] = [];
  const edges: BranchEdge[] = [];
  const seenChildIds = new Set<string>();
  const firstCreatedOrdinal = Object.keys(state.branches).length;

  parsed.question.options.forEach((option, ordinal) => {
    const step: DecisionStep = {
      questionId,
      questionSemanticKey: parsed.question.semanticKey,
      questionText: parsed.question.text,
      optionKey: option.key,
      optionLabel: option.label,
      optionDescription: option.description,
      expectedConsequences: [...option.expectedConsequences],
      assumptions: [...option.assumptions],
      tradeoffs: [...option.tradeoffs],
      wasQuestionRecommendation: parsed.question.recommendation.optionKey === option.key,
    };
    const path = [...branch.path, step];
    const childId = createChildBranchId(
      branch.branchStateHash,
      parsed.question.semanticKey,
      option.key,
    );
    if (seenChildIds.has(childId) || state.branches[childId]) {
      throw new Error(`Deterministic child ID collision: ${childId}`);
    }
    seenChildIds.add(childId);
    childBranches.push({
      id: childId,
      parentId: branch.id,
      depth: branch.depth + 1,
      path,
      branchStateHash: branchStateHash(path),
      status: "frontier",
      createdOrdinal: firstCreatedOrdinal + ordinal,
      selectedBy: { questionId, optionKey: option.key, optionOrdinal: ordinal },
      expandedByQuestionId: null,
      terminalReason: null,
      conclusion: null,
      evaluations: [],
      failure: null,
    });
    edges.push({
      id: createEdgeId(branch.id, childId, questionId, ordinal),
      parentBranchId: branch.id,
      childBranchId: childId,
      questionId,
      optionKey: option.key,
      ordinal,
    });
  });

  return {
    parentBranchId: branch.id,
    expansion: {
      id: expansionId,
      questionId,
      branchId: branch.id,
      question: parsed.question,
      childBranchIds: childBranches.map((child) => child.id),
    },
    childBranches,
    edges,
  };
}

export function createBranchExpandedEvent(
  state: DecisionState,
  branchId: string,
  resolution: unknown,
): DecisionEvent {
  return createDecisionEvent(state, {
    type: "branch_expanded",
    materialized: materializeExpansion(state, branchId, resolution),
  });
}
