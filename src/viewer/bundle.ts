import { backpropagate, type LeafScore } from "../core/backpropagate.js";
import { canonicalJson, hashCanonical } from "../core/canonical-json.js";
import { assembleDossier, type DecisionDossier } from "../core/dossier.js";
import { assertGraphInvariants } from "../core/invariants.js";
import type {
  BranchEdge,
  BranchNode,
  DecisionState,
  DecisionStep,
  QuestionExpansion,
} from "../domain/state.js";
import type {
  DecisionViewerBundle,
  ViewerAnswerEdge,
  ViewerNode,
  ViewerNodeKind,
  ViewerNodeScore,
  ViewerQuestion,
  ViewerRanking,
  ViewerRelation,
} from "./types.js";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function branchCompare(left: BranchNode, right: BranchNode): number {
  return left.createdOrdinal - right.createdOrdinal || compareText(left.id, right.id);
}

function pathKey(path: readonly DecisionStep[]): string {
  return path
    .map(
      (step) =>
        `${encodeURIComponent(step.questionSemanticKey)}=${encodeURIComponent(step.optionKey)}`,
    )
    .join("/");
}

function shortLabel(value: string, maximum = 72): string {
  const characters = Array.from(value);
  if (characters.length <= maximum) return value;
  return `${characters.slice(0, maximum - 1).join("")}…`;
}

function comparableDossier(dossier: DecisionDossier): DecisionDossier {
  const comparable = structuredClone(dossier);
  comparable.exploration.edges.sort((left, right) => compareText(left.id, right.id));
  comparable.uncertainty.unscoredBranchIds.sort(compareText);
  comparable.uncertainty.sources.sort(compareText);
  return comparable;
}

function expansionByBranch(state: DecisionState): Map<string, QuestionExpansion> {
  const result = new Map<string, QuestionExpansion>();
  for (const expansion of Object.values(state.expansions)) {
    if (result.has(expansion.branchId)) {
      throw new Error(`Branch ${expansion.branchId} has more than one expansion`);
    }
    result.set(expansion.branchId, expansion);
  }
  return result;
}

function validateProjectionSource(
  state: DecisionState,
  expansions: ReadonlyMap<string, QuestionExpansion>,
): {
  incomingByChild: Map<string, BranchEdge>;
  childrenByParent: Map<string, BranchEdge[]>;
} {
  assertGraphInvariants(state);
  const incomingByChild = new Map<string, BranchEdge>();
  const childrenByParent = new Map<string, BranchEdge[]>();
  for (const edge of state.edges) {
    if (incomingByChild.has(edge.childBranchId)) {
      throw new Error(`Branch ${edge.childBranchId} has more than one incoming edge`);
    }
    incomingByChild.set(edge.childBranchId, edge);
    childrenByParent.set(edge.parentBranchId, [
      ...(childrenByParent.get(edge.parentBranchId) ?? []),
      edge,
    ]);
  }
  for (const edges of childrenByParent.values()) {
    edges.sort(
      (left, right) =>
        left.ordinal - right.ordinal || compareText(left.childBranchId, right.childBranchId),
    );
  }

  for (const branch of Object.values(state.branches)) {
    const expansion = expansions.get(branch.id);
    if (branch.status === "expanded") {
      if (!expansion || branch.expandedByQuestionId !== expansion.questionId) {
        throw new Error(`Expanded branch ${branch.id} has no matching expansion`);
      }
    } else if (expansion) {
      throw new Error(`Non-expanded branch ${branch.id} owns an expansion`);
    }
    if (branch.id === state.rootBranchId) {
      if (incomingByChild.has(branch.id)) throw new Error("Root branch has an incoming edge");
    } else if (!incomingByChild.has(branch.id)) {
      throw new Error(`Branch ${branch.id} has no incoming edge`);
    }
  }

  for (const [parentId, edges] of childrenByParent) {
    const expansion = expansions.get(parentId);
    if (!expansion) throw new Error(`Answer edges leave branch ${parentId} without an expansion`);
    if (edges.length !== expansion.question.options.length) {
      throw new Error(`Expansion ${expansion.id} answer-edge count does not match its options`);
    }
    edges.forEach((edge, ordinal) => {
      const option = expansion.question.options[ordinal];
      const childId = expansion.childBranchIds[ordinal];
      const child = state.branches[edge.childBranchId];
      if (
        !option ||
        !child ||
        edge.ordinal !== ordinal ||
        edge.questionId !== expansion.questionId ||
        edge.optionKey !== option.key ||
        edge.childBranchId !== childId ||
        child.selectedBy?.questionId !== edge.questionId ||
        child.selectedBy.optionKey !== edge.optionKey ||
        child.selectedBy.optionOrdinal !== ordinal
      ) {
        throw new Error(`Expansion ${expansion.id} option/edge/child mismatch at ordinal ${ordinal}`);
      }
      const expectedStep: DecisionStep = {
        questionId: expansion.questionId,
        questionSemanticKey: expansion.question.semanticKey,
        questionText: expansion.question.text,
        optionKey: option.key,
        optionLabel: option.label,
        optionDescription: option.description,
        expectedConsequences: option.expectedConsequences,
        assumptions: option.assumptions,
        tradeoffs: option.tradeoffs,
        wasQuestionRecommendation:
          expansion.question.recommendation.optionKey === option.key,
      };
      const actualStep = child.path.at(-1);
      if (!actualStep || canonicalJson(actualStep) !== canonicalJson(expectedStep)) {
        throw new Error(`Branch ${child.id} does not retain its incoming answer exactly`);
      }
    });
  }

  const visited = new Set<string>();
  const stack = [state.rootBranchId];
  while (stack.length > 0) {
    const branchId = stack.pop();
    if (!branchId || visited.has(branchId)) continue;
    visited.add(branchId);
    const children = childrenByParent.get(branchId) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child) stack.push(child.childBranchId);
    }
  }
  if (visited.size !== Object.keys(state.branches).length) {
    throw new Error("Viewer source contains unreachable branches");
  }
  return { incomingByChild, childrenByParent };
}

function nodeKind(branch: BranchNode, expansion: QuestionExpansion | undefined): ViewerNodeKind {
  if (branch.status === "failed") return "failed";
  if (branch.status === "frontier" || branch.status === "expanding") return "open";
  if (expansion) return "question";
  if (branch.status === "terminal" && branch.terminalReason === "resolved") {
    if (!branch.conclusion) throw new Error(`Resolved branch ${branch.id} has no conclusion`);
    return "conclusion";
  }
  if (branch.status === "terminal") return "boundary";
  throw new Error(`Cannot project branch ${branch.id} from status ${branch.status}`);
}

function labelFor(branch: BranchNode, kind: ViewerNodeKind, expansion?: QuestionExpansion): string {
  if (kind === "question" && expansion) return expansion.question.text;
  if (kind === "conclusion") return branch.conclusion?.summary ?? "Resolved conclusion";
  if (kind === "failed") return "Branch failed";
  if (kind === "open") return branch.status === "expanding" ? "Expanding branch" : "Open branch";
  const labels: Record<string, string> = {
    depth_limit: "Depth limit reached",
    budget_limit: "Budget limit reached",
    safety_limit: "Safety limit reached",
  };
  return labels[branch.terminalReason ?? ""] ?? "Configured boundary reached";
}

function scoreFor(
  branch: BranchNode,
  isLeaf: boolean,
  leafScore: LeafScore | undefined,
  leafRank: number | undefined,
  subtree: ReturnType<typeof backpropagate>["subtrees"][string] | undefined,
): ViewerNodeScore {
  const base = {
    leafRank: leafRank ?? null,
    adjusted: leafScore?.adjustedScore ?? null,
    raw: leafScore?.rawScore ?? null,
    confidence: leafScore?.confidence ?? null,
    evaluatorCount: branch.evaluations.length,
    subtree: subtree ? structuredClone(subtree) : null,
  };
  if (branch.status === "failed") {
    return { state: "unscored", absentReason: "failed", ...base };
  }
  if (branch.status === "frontier" || branch.status === "expanding") {
    return { state: "unscored", absentReason: "open", ...base };
  }
  if (leafScore) return { state: "scored_leaf", absentReason: null, ...base };
  if (isLeaf) return { state: "unscored", absentReason: "unevaluated", ...base };
  if (subtree) return { state: "scored_subtree", absentReason: null, ...base };
  return {
    state: "not_applicable",
    absentReason: "no_scored_descendant",
    ...base,
  };
}

function makePreorder(
  rootBranchId: string,
  childrenByParent: ReadonlyMap<string, readonly BranchEdge[]>,
): Map<string, number> {
  const result = new Map<string, number>();
  const stack = [rootBranchId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (!id) continue;
    result.set(id, result.size);
    const children = childrenByParent.get(id) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child) stack.push(child.childBranchId);
    }
  }
  return result;
}

export function deriveViewerBundle(
  state: DecisionState,
  suppliedDossier?: DecisionDossier,
): DecisionViewerBundle {
  const expansions = expansionByBranch(state);
  const { incomingByChild, childrenByParent } = validateProjectionSource(state, expansions);
  const expectedDossier = assembleDossier(state);
  if (
    suppliedDossier &&
    canonicalJson(comparableDossier(suppliedDossier)) !==
      canonicalJson(comparableDossier(expectedDossier))
  ) {
    throw new Error("Decision Dossier does not match the current DecisionState");
  }
  const dossier = suppliedDossier ?? expectedDossier;
  const result = backpropagate(state);
  const orderedBranches = Object.values(state.branches).sort(branchCompare);
  const preorder = makePreorder(state.rootBranchId, childrenByParent);
  const rankByBranch = new Map(
    result.rankedLeaves.map((score, index) => [score.branchId, index + 1]),
  );
  const leafScoreByBranch = new Map(
    result.leafScores.map((score) => [score.branchId, score]),
  );
  const winningBranchId = result.rankedLeaves[0]?.branchId ?? null;
  const winningNodes = new Set<string>();
  const winningEdges = new Set<string>();
  if (winningBranchId) {
    let cursor: string | null = winningBranchId;
    while (cursor) {
      if (winningNodes.has(cursor)) throw new Error("Cycle in winning branch ancestry");
      winningNodes.add(cursor);
      const incoming = incomingByChild.get(cursor);
      if (incoming) winningEdges.add(incoming.id);
      cursor = state.branches[cursor]?.parentId ?? null;
    }
    if (!winningNodes.has(state.rootBranchId)) {
      throw new Error("Winning branch ancestry does not reach the root");
    }
  }

  const hindsightEdgeIds = new Set<string>();
  const questionByBranch = new Map<string, ViewerQuestion>();
  for (const expansion of [...expansions.values()].sort((left, right) => {
    const leftBranch = state.branches[left.branchId];
    const rightBranch = state.branches[right.branchId];
    if (!leftBranch || !rightBranch) return compareText(left.branchId, right.branchId);
    return branchCompare(leftBranch, rightBranch);
  })) {
    const children = childrenByParent.get(expansion.branchId) ?? [];
    let bestEdge: BranchEdge | undefined;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const edge of children) {
      const score = result.subtrees[edge.childBranchId];
      if (score && score.best > bestScore) {
        bestScore = score.best;
        bestEdge = edge;
      }
    }
    if (bestEdge) hindsightEdgeIds.add(bestEdge.id);
    const bestSubtree = bestEdge ? result.subtrees[bestEdge.childBranchId] : undefined;
    questionByBranch.set(expansion.branchId, {
      expansionId: expansion.id,
      questionId: expansion.questionId,
      semanticKey: expansion.question.semanticKey,
      text: expansion.question.text,
      rationale: expansion.question.rationale,
      resolves: [...expansion.question.resolves],
      coverageRationale: expansion.question.coverageRationale,
      atomicityRationale: expansion.question.atomicityRationale,
      exclusivityRationale: expansion.question.exclusivityRationale,
      localRecommendation: structuredClone(expansion.question.recommendation),
      hindsight: {
        optionKey: bestEdge?.optionKey ?? null,
        bestDescendantBranchId: bestSubtree?.bestDescendantBranchId ?? null,
        changedLocalRecommendation: bestEdge
          ? bestEdge.optionKey !== expansion.question.recommendation.optionKey
          : null,
      },
    });
  }

  const unscoredLeafIds = new Set(dossier.uncertainty.unscoredBranchIds);
  const nodes: ViewerNode[] = orderedBranches.map((branch) => {
    const expansion = expansions.get(branch.id);
    const kind = nodeKind(branch, expansion);
    const children = childrenByParent.get(branch.id) ?? [];
    const isLeaf = children.length === 0;
    const incoming = incomingByChild.get(branch.id);
    const label = labelFor(branch, kind, expansion);
    const preorderOrdinal = preorder.get(branch.id);
    if (preorderOrdinal === undefined) throw new Error(`Missing preorder for ${branch.id}`);
    return {
      id: branch.id,
      parentId: branch.parentId,
      depth: branch.depth,
      createdOrdinal: branch.createdOrdinal,
      preorderOrdinal,
      kind,
      status: branch.status,
      terminalReason: branch.terminalReason,
      label,
      shortLabel: shortLabel(label),
      pathKey: pathKey(branch.path),
      incomingAnswer: branch.path.at(-1)
        ? structuredClone(branch.path.at(-1) ?? null)
        : null,
      question: questionByBranch.get(branch.id) ?? null,
      conclusion: branch.conclusion ? structuredClone(branch.conclusion) : null,
      evaluations: structuredClone(branch.evaluations),
      failure: branch.failure,
      score: scoreFor(
        branch,
        isLeaf,
        leafScoreByBranch.get(branch.id),
        rankByBranch.get(branch.id),
        result.subtrees[branch.id],
      ),
      flags: {
        isRoot: branch.id === state.rootBranchId,
        isLeaf,
        isWinningLeaf: branch.id === winningBranchId,
        isOnWinningPath: winningNodes.has(branch.id),
        isLocallyRecommendedIncoming:
          branch.path.at(-1)?.wasQuestionRecommendation ?? false,
        isHindsightBestIncoming: incoming ? hindsightEdgeIds.has(incoming.id) : false,
        isUnscoredLeaf: unscoredLeafIds.has(branch.id),
      },
    };
  });

  const edges: ViewerAnswerEdge[] = [...state.edges]
    .sort((left, right) => {
      const leftParent = state.branches[left.parentBranchId];
      const rightParent = state.branches[right.parentBranchId];
      if (!leftParent || !rightParent) return compareText(left.id, right.id);
      return (
        branchCompare(leftParent, rightParent) ||
        left.ordinal - right.ordinal ||
        compareText(left.id, right.id)
      );
    })
    .map((edge) => {
      const expansion = expansions.get(edge.parentBranchId);
      const option = expansion?.question.options[edge.ordinal];
      if (!expansion || !option) throw new Error(`Missing option for edge ${edge.id}`);
      return {
        id: edge.id,
        source: edge.parentBranchId,
        target: edge.childBranchId,
        questionId: edge.questionId,
        optionKey: edge.optionKey,
        optionOrdinal: edge.ordinal,
        label: option.label,
        description: option.description,
        expectedConsequences: [...option.expectedConsequences],
        assumptions: [...option.assumptions],
        tradeoffs: [...option.tradeoffs],
        flags: {
          isLocalRecommendation:
            expansion.question.recommendation.optionKey === edge.optionKey,
          isHindsightChoice: hindsightEdgeIds.has(edge.id),
          isOnWinningPath: winningEdges.has(edge.id),
        },
      };
    });

  const questionGroups = new Map<string, ViewerNode[]>();
  for (const node of nodes) {
    if (!node.question) continue;
    questionGroups.set(node.question.semanticKey, [
      ...(questionGroups.get(node.question.semanticKey) ?? []),
      node,
    ]);
  }
  const relations: ViewerRelation[] = [];
  for (const semanticKey of [...questionGroups.keys()].sort(compareText)) {
    const group = (questionGroups.get(semanticKey) ?? []).sort(
      (left, right) =>
        left.createdOrdinal - right.createdOrdinal || compareText(left.id, right.id),
    );
    for (let index = 1; index < group.length; index += 1) {
      const source = group[index - 1];
      const target = group[index];
      if (!source || !target) continue;
      relations.push({
        id: `relation_${hashCanonical({ kind: "semantic_peer", semanticKey, source: source.id, target: target.id }).slice(0, 24)}`,
        kind: "semantic_peer",
        source: source.id,
        target: target.id,
        semanticKey,
        canonical: false,
      });
    }
  }

  const alternatives = [
    ...(dossier.recommendation ? [dossier.recommendation] : []),
    ...dossier.rankedAlternatives,
  ];
  const rankings: ViewerRanking[] = alternatives
    .map((alternative) => ({
      rank: alternative.rank,
      branchId: alternative.branchId,
      adjustedScore: alternative.score,
      rawScore: alternative.rawScore,
      confidence: alternative.confidence,
      recommendation: alternative.recommendation,
      pathKey: pathKey(alternative.path),
    }))
    .sort((left, right) => left.rank - right.rank);

  return {
    schemaVersion: 1,
    generatedFrom: {
      graphSchemaVersion: state.schemaVersion,
      dossierSchemaVersion: suppliedDossier ? suppliedDossier.schemaVersion : null,
      eventsApplied: state.eventsApplied,
      lastEventId: state.lastEventId,
    },
    run: {
      runId: state.runId,
      title: state.request.title,
      decisionStatement: state.request.decisionStatement,
      requestKey: hashCanonical(state.request),
      configKey: hashCanonical(state.config),
      completion: dossier.completeness,
      completionReasons: [...(state.completion?.reasons ?? [])],
      approval: structuredClone(dossier.approval),
      traversal: state.config.traversal,
      policy: state.config.completion,
    },
    summary: {
      branchCount: nodes.length,
      edgeCount: edges.length,
      questionCount: expansions.size,
      maxDepth: Math.max(...nodes.map((node) => node.depth)),
      evaluatedLeaves: result.leafScores.length,
      failedBranches: nodes.filter((node) => node.kind === "failed").length,
      openBranches: nodes.filter((node) => node.kind === "open").length,
      winningBranchId,
      winningAdjustedScore: result.rankedLeaves[0]?.adjustedScore ?? null,
      usage: structuredClone(state.usage),
    },
    criteria: structuredClone(state.request.criteria),
    nodes,
    edges,
    relations,
    rankings,
    uncertainty: {
      unscoredBranchIds: [...dossier.uncertainty.unscoredBranchIds].sort(compareText),
      sources: [...dossier.uncertainty.sources].sort(compareText),
    },
  };
}
