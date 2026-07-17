import type {
  Approval,
  BootstrapConfiguration,
  BranchConclusion,
  BranchEvaluation,
  CandidateOption,
  DecisionRequest,
  FinalResolution,
} from "./schemas.js";

export type BranchStatus =
  | "frontier"
  | "expanding"
  | "expanded"
  | "terminal"
  | "failed";

export type BranchTerminalReason =
  | "resolved"
  | "depth_limit"
  | "budget_limit"
  | "safety_limit"
  | "failed";

export type RunCompletionClassification =
  | "coverage_complete"
  | "partial_budget_exhausted"
  | "partial_safety_limit"
  | "partial_failure";

export type ExpansionQuestion = Extract<
  FinalResolution,
  { type: "expand" }
>["question"];

/**
 * One committed answer in a branch's history. Array order is semantic: changing
 * the order changes the branch and its deterministic state hash.
 */
export interface DecisionStep {
  questionId: string;
  questionSemanticKey: string;
  questionText: string;
  optionKey: string;
  optionLabel: string;
  optionDescription: string;
  expectedConsequences: string[];
  assumptions: string[];
  tradeoffs: string[];
  wasQuestionRecommendation: boolean;
}

export interface SelectedAnswer {
  questionId: string;
  optionKey: string;
  optionOrdinal: number;
}

export interface RecordedEvaluation {
  id: string;
  evaluatorOrdinal: number;
  evaluation: BranchEvaluation;
}

/**
 * A Decision Branch is deliberately a tree node in v1. It has exactly one
 * parent and retains its complete, ordered history. Semantic merging is not
 * performed.
 */
export interface BranchNode {
  id: string;
  parentId: string | null;
  depth: number;
  path: DecisionStep[];
  branchStateHash: string;
  status: BranchStatus;
  createdOrdinal: number;
  selectedBy: SelectedAnswer | null;
  expandedByQuestionId: string | null;
  terminalReason: BranchTerminalReason | null;
  conclusion: BranchConclusion | null;
  evaluations: RecordedEvaluation[];
  failure: string | null;
}

export interface QuestionExpansion {
  id: string;
  questionId: string;
  branchId: string;
  question: ExpansionQuestion;
  /** Child order always matches question.options order. */
  childBranchIds: string[];
}

export interface BranchEdge {
  id: string;
  parentBranchId: string;
  childBranchId: string;
  questionId: string;
  optionKey: string;
  ordinal: number;
}

export interface UsageCounters {
  questions: number;
  agentCalls: number;
  retries: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  wallTimeMs: number;
}

export interface RunCompletion {
  classification: RunCompletionClassification;
  reasons: string[];
}

export interface DecisionState {
  schemaVersion: 1;
  runId: string;
  request: DecisionRequest;
  config: BootstrapConfiguration;
  rootBranchId: string;
  branches: Record<string, BranchNode>;
  expansions: Record<string, QuestionExpansion>;
  edges: BranchEdge[];
  usage: UsageCounters;
  completion: RunCompletion | null;
  approval: Approval | null;
  eventsApplied: number;
  lastEventId: string;
}

export interface MaterializedExpansion {
  parentBranchId: string;
  expansion: QuestionExpansion;
  childBranches: BranchNode[];
  edges: BranchEdge[];
}

export interface MaterializedConclusion {
  branchId: string;
  conclusion: BranchConclusion;
}

export interface CanonicalDecisionStep {
  questionId: string;
  questionSemanticKey: string;
  questionText: string;
  optionKey: string;
  optionLabel: string;
  optionDescription: string;
  expectedConsequences: string[];
  assumptions: string[];
  tradeoffs: string[];
  wasQuestionRecommendation: boolean;
}

export interface ExpansionValidationResult {
  valid: boolean;
  errors: string[];
  options: CandidateOption[];
}
