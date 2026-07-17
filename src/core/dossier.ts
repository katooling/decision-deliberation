import type { EvidenceItemSchema } from "../domain/schemas.js";
import type { DecisionState, DecisionStep, RunCompletionClassification } from "../domain/state.js";
import type { z } from "zod";
import { canonicalJson } from "./canonical-json.js";
import { backpropagate, type BackpropagationResult, type LeafScore } from "./backpropagate.js";
import { checkTermination } from "./termination.js";

type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export interface DossierAlternative {
  rank: number;
  branchId: string;
  score: number;
  rawScore: number;
  confidence: number;
  summary: string;
  recommendation: string;
  path: DecisionStep[];
  conditions: string[];
  caveats: string[];
}

export interface DecisionDossier {
  schemaVersion: 1;
  runId: string;
  title: string;
  decisionStatement: string;
  completeness: RunCompletionClassification | "in_progress";
  recommendation: DossierAlternative | null;
  rankedAlternatives: DossierAlternative[];
  reasoning: { assumptions: string[]; tradeoffs: string[]; unresolvedQuestions: string[] };
  evidence: EvidenceItem[];
  uncertainty: { unscoredBranchIds: string[]; sources: string[] };
  exploration: {
    rootBranchId: string;
    branchCount: number;
    questionCount: number;
    maxDepth: number;
    branches: DecisionState["branches"];
    expansions: DecisionState["expansions"];
    edges: DecisionState["edges"];
  };
  aggregation: { root: BackpropagationResult["root"]; subtrees: BackpropagationResult["subtrees"] };
  stats: DecisionState["usage"] & { eventCount: number; evaluatedLeaves: number };
  approval:
    | { status: "awaiting_human_approval" }
    | ({ status: "approved" | "rejected" } & NonNullable<DecisionState["approval"]>);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function alternative(state: DecisionState, score: LeafScore, rank: number): DossierAlternative {
  const branch = state.branches[score.branchId];
  if (!branch) throw new Error(`Unknown ranked branch ${score.branchId}`);
  const conclusion = branch.conclusion ?? branch.evaluations[0]?.evaluation.conclusion;
  return {
    rank,
    branchId: branch.id,
    score: score.adjustedScore,
    rawScore: score.rawScore,
    confidence: score.confidence,
    summary: conclusion?.summary ?? "Branch reached a configured boundary without a conclusion.",
    recommendation: conclusion?.recommendation ?? "No recommendation available.",
    path: branch.path,
    conditions: conclusion?.conditions ?? [],
    caveats: conclusion?.caveats ?? [],
  };
}

export function assembleDossier(
  state: DecisionState,
  result: BackpropagationResult = backpropagate(state),
): DecisionDossier {
  const completion = state.completion?.classification ?? checkTermination(state).classification ?? "in_progress";
  const ranked = result.rankedLeaves.map((score, index) => alternative(state, score, index + 1));
  const evaluations = Object.values(state.branches).flatMap((branch) => branch.evaluations.map((item) => item.evaluation));
  const evidenceByKey = new Map<string, EvidenceItem>();
  for (const item of evaluations.flatMap((evaluation) => evaluation.evidence)) evidenceByKey.set(canonicalJson(item), item);
  const assumptions = uniqueSorted([
    ...Object.values(state.branches).flatMap((branch) => branch.path.flatMap((step) => step.assumptions)),
    ...evaluations.flatMap((evaluation) => evaluation.assumptions),
  ]);
  const tradeoffs = uniqueSorted(Object.values(state.branches).flatMap((branch) => branch.path.flatMap((step) => step.tradeoffs)));
  const unresolvedQuestions = uniqueSorted(Object.values(state.branches).flatMap((branch) => branch.conclusion?.unresolvedQuestions ?? []));
  return {
    schemaVersion: 1,
    runId: state.runId,
    title: state.request.title,
    decisionStatement: state.request.decisionStatement,
    completeness: completion,
    recommendation: ranked[0] ?? null,
    rankedAlternatives: ranked.slice(1),
    reasoning: { assumptions, tradeoffs, unresolvedQuestions },
    evidence: [...evidenceByKey.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => item),
    uncertainty: {
      unscoredBranchIds: [...result.unscoredLeafBranchIds],
      sources: uniqueSorted([
        ...(result.unscoredLeafBranchIds.length > 0 ? ["Some terminal branches have no evaluation."] : []),
        ...evaluations.flatMap((evaluation) => evaluation.caveats),
      ]),
    },
    exploration: {
      rootBranchId: state.rootBranchId,
      branchCount: Object.keys(state.branches).length,
      questionCount: Object.keys(state.expansions).length,
      maxDepth: Math.max(...Object.values(state.branches).map((branch) => branch.depth)),
      branches: state.branches,
      expansions: state.expansions,
      edges: state.edges,
    },
    aggregation: { root: result.root, subtrees: result.subtrees },
    stats: { ...state.usage, eventCount: state.eventsApplied, evaluatedLeaves: result.leafScores.length },
    approval: state.approval
      ? { status: state.approval.decision, ...state.approval }
      : { status: "awaiting_human_approval" },
  };
}

export const buildDecisionDossier = assembleDossier;
