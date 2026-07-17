import type { ExpansionQuestion } from "../domain/state.js";
import type { DecisionStep } from "../domain/state.js";
import { canonicalSet, hashCanonical } from "./canonical-json.js";

const ID_HASH_LENGTH = 24;

function id(prefix: string, input: unknown): string {
  return `${prefix}_${hashCanonical(input).slice(0, ID_HASH_LENGTH)}`;
}

export const ROOT_BRANCH_ID = "branch_root";

export function canonicalDecisionPath(path: readonly DecisionStep[]): unknown[] {
  return path.map((step) => ({
    questionId: step.questionId,
    questionSemanticKey: step.questionSemanticKey,
    questionText: step.questionText,
    optionKey: step.optionKey,
    optionLabel: step.optionLabel,
    optionDescription: step.optionDescription,
    expectedConsequences: canonicalSet(step.expectedConsequences),
    assumptions: canonicalSet(step.assumptions),
    tradeoffs: canonicalSet(step.tradeoffs),
    wasQuestionRecommendation: step.wasQuestionRecommendation,
  }));
}

export function branchStateHash(path: readonly DecisionStep[]): string {
  return hashCanonical(canonicalDecisionPath(path));
}

export function createQuestionId(
  branchId: string,
  question: ExpansionQuestion,
): string {
  return id("question", {
    branchId,
    question: {
      ...question,
      resolves: canonicalSet(question.resolves),
      options: question.options.map((option) => ({
        ...option,
        expectedConsequences: canonicalSet(option.expectedConsequences),
        assumptions: canonicalSet(option.assumptions),
        tradeoffs: canonicalSet(option.tradeoffs),
      })),
    },
  });
}

export function createExpansionId(questionId: string): string {
  return id("expansion", { questionId });
}

export function createChildBranchId(
  parentBranchStateHash: string,
  questionSemanticKey: string,
  optionKey: string,
): string {
  return id("branch", {
    parentBranchStateHash,
    questionSemanticKey,
    optionKey,
  });
}

export function createEdgeId(
  parentBranchId: string,
  childBranchId: string,
  questionId: string,
  ordinal: number,
): string {
  return id("edge", { parentBranchId, childBranchId, questionId, ordinal });
}

export function createEvaluationId(
  branchId: string,
  evaluatorOrdinal: number,
  evaluation: unknown,
): string {
  return id("evaluation", { branchId, evaluatorOrdinal, evaluation });
}

export function createAgentCallId(
  runId: string,
  branchId: string,
  role: string,
  ordinal: number,
  attempt: number,
): string {
  return id("call", { runId, branchId, role, ordinal, attempt });
}

export function createRunId(request: unknown, config: unknown): string {
  return id("run", { request, config });
}

export function createEventId(
  runId: string,
  sequence: number,
  event: unknown,
): string {
  return id("event", { runId, sequence, event });
}
