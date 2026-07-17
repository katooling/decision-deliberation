import type { DecisionDossier } from "../core/dossier.js";
import type { SubtreeScore } from "../core/backpropagate.js";
import type {
  BranchNode,
  BranchStatus,
  BranchTerminalReason,
  DecisionStep,
  RecordedEvaluation,
  UsageCounters,
} from "../domain/state.js";
import type {
  BranchConclusion,
  DecisionCriterion,
} from "../domain/schemas.js";

export type ViewerCompletion =
  | "in_progress"
  | "coverage_complete"
  | "partial_budget_exhausted"
  | "partial_safety_limit"
  | "partial_failure";

export type ViewerNodeKind =
  | "question"
  | "conclusion"
  | "boundary"
  | "open"
  | "failed";

export type ViewerScoreState =
  | "scored_leaf"
  | "scored_subtree"
  | "unscored"
  | "not_applicable";

export type ViewerScoreAbsentReason =
  | "failed"
  | "open"
  | "unevaluated"
  | "no_scored_descendant";

export interface ViewerQuestion {
  expansionId: string;
  questionId: string;
  semanticKey: string;
  text: string;
  rationale: string;
  resolves: string[];
  coverageRationale: string;
  atomicityRationale: string;
  exclusivityRationale: string;
  localRecommendation: {
    optionKey: string;
    reason: string;
    confidence: number;
  };
  hindsight: {
    optionKey: string | null;
    bestDescendantBranchId: string | null;
    changedLocalRecommendation: boolean | null;
  };
}

export interface ViewerNodeScore {
  state: ViewerScoreState;
  absentReason: ViewerScoreAbsentReason | null;
  leafRank: number | null;
  adjusted: number | null;
  raw: number | null;
  confidence: number | null;
  evaluatorCount: number;
  subtree: SubtreeScore | null;
}

export interface ViewerNode {
  id: string;
  parentId: string | null;
  depth: number;
  createdOrdinal: number;
  preorderOrdinal: number;
  kind: ViewerNodeKind;
  status: BranchStatus;
  terminalReason: BranchTerminalReason | null;
  label: string;
  shortLabel: string;
  pathKey: string;
  incomingAnswer: DecisionStep | null;
  question: ViewerQuestion | null;
  conclusion: BranchConclusion | null;
  evaluations: RecordedEvaluation[];
  failure: string | null;
  score: ViewerNodeScore;
  flags: {
    isRoot: boolean;
    isLeaf: boolean;
    isWinningLeaf: boolean;
    isOnWinningPath: boolean;
    isLocallyRecommendedIncoming: boolean;
    isHindsightBestIncoming: boolean;
    isUnscoredLeaf: boolean;
  };
}

export interface ViewerAnswerEdge {
  id: string;
  source: string;
  target: string;
  questionId: string;
  optionKey: string;
  optionOrdinal: number;
  label: string;
  description: string;
  expectedConsequences: string[];
  assumptions: string[];
  tradeoffs: string[];
  flags: {
    isLocalRecommendation: boolean;
    isHindsightChoice: boolean;
    isOnWinningPath: boolean;
  };
}

export interface ViewerRelation {
  id: string;
  kind: "semantic_peer";
  source: string;
  target: string;
  semanticKey: string;
  canonical: false;
}

export interface ViewerRanking {
  rank: number;
  branchId: string;
  adjustedScore: number;
  rawScore: number;
  confidence: number;
  recommendation: string;
  pathKey: string;
}

export interface DecisionViewerBundle {
  schemaVersion: 1;
  generatedFrom: {
    graphSchemaVersion: 1;
    dossierSchemaVersion: 1 | null;
    eventsApplied: number;
    lastEventId: string;
  };
  run: {
    runId: string;
    title: string;
    decisionStatement: string;
    requestKey: string;
    configKey: string;
    completion: ViewerCompletion;
    completionReasons: string[];
    approval: DecisionDossier["approval"];
    traversal: "bfs" | "dfs";
    policy: "coverage" | "budget";
  };
  summary: {
    branchCount: number;
    edgeCount: number;
    questionCount: number;
    maxDepth: number;
    evaluatedLeaves: number;
    failedBranches: number;
    openBranches: number;
    winningBranchId: string | null;
    winningAdjustedScore: number | null;
    usage: UsageCounters;
  };
  criteria: DecisionCriterion[];
  nodes: ViewerNode[];
  edges: ViewerAnswerEdge[];
  relations: ViewerRelation[];
  rankings: ViewerRanking[];
  uncertainty: DecisionDossier["uncertainty"];
}

export interface Point {
  x: number;
  y: number;
}

export interface PositionedViewerNode extends Point {
  id: string;
  width: number;
  height: number;
  relativeDepth: number;
}

export interface PositionedViewerEdge {
  id: string;
  source: string;
  target: string;
  points: Point[];
}

export interface PositionedViewerRelation {
  id: string;
  source: string;
  target: string;
  points: Point[];
}

export interface PositionedViewerGraph {
  nodes: PositionedViewerNode[];
  edges: PositionedViewerEdge[];
  relations: PositionedViewerRelation[];
  hiddenDescendantCounts: Record<string, number>;
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
}

export type ViewerBranchSource = Pick<
  BranchNode,
  "id" | "parentId" | "createdOrdinal"
>;
