import type { DecisionDossier, DossierAlternative } from "../core/dossier.js";

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function list(values: readonly string[], empty = "None recorded."): string[] {
  return values.length === 0 ? [empty] : values.map((value) => `- ${value}`);
}

function path(alternative: DossierAlternative): string[] {
  if (alternative.path.length === 0) return ["The recommendation resolves at the root decision."];
  return alternative.path.map(
    (step, index) => `${index + 1}. **${step.questionText}** → ${step.optionLabel}`,
  );
}

function approvalStatus(dossier: DecisionDossier): string {
  if (dossier.approval.status === "awaiting_human_approval") {
    return "Proposed — awaiting human approval";
  }
  return dossier.approval.status === "approved" ? "Accepted" : "Rejected";
}

/** Render a portable, review-ready ADR without hiding incomplete evidence. */
export function renderDecisionAdr(dossier: DecisionDossier): string {
  const recommendation = dossier.recommendation;
  const lines = [
    `# ADR: ${dossier.title}`,
    "",
    `Status: ${approvalStatus(dossier)}`,
    `Evidence coverage: ${dossier.completeness === "coverage_complete" ? "Bounded coverage complete" : `Partial evidence: ${dossier.completeness}`}`,
    "",
    "## Decision",
    "",
    dossier.decisionStatement,
    "",
    "## Recommendation",
    "",
  ];

  if (recommendation === null) {
    lines.push("No scored recommendation is available.", "");
  } else {
    lines.push(
      `**${recommendation.recommendation}**`,
      "",
      recommendation.summary,
      "",
      `Score: ${percent(recommendation.score)}; confidence: ${percent(recommendation.confidence)}.`,
      "",
      "### Recommended path",
      "",
      ...path(recommendation),
      "",
      "### Conditions",
      "",
      ...list(recommendation.conditions),
      "",
      "### Caveats",
      "",
      ...list(recommendation.caveats),
      "",
    );
  }

  lines.push("## Alternatives considered", "");
  if (dossier.rankedAlternatives.length === 0) {
    lines.push("No scored alternative is available.", "");
  } else {
    for (const alternative of dossier.rankedAlternatives) {
      const scoreGap = recommendation === null
        ? null
        : Math.max(0, (recommendation.score - alternative.score) * 100);
      lines.push(
        `### ${alternative.rank}. ${alternative.recommendation}`,
        "",
        `${alternative.summary} Score: ${percent(alternative.score)}; confidence: ${percent(alternative.confidence)}.`,
        "",
        ...(scoreGap === null
          ? []
          : [`Why it ranked lower: ${scoreGap.toFixed(1)} points behind the recommendation after criteria and confidence adjustment.`, ""]),
        ...list(alternative.caveats, "No additional caveat was recorded."),
        "",
      );
    }
  }

  lines.push(
    "## Assumptions",
    "",
    ...list(dossier.reasoning.assumptions),
    "",
    "## Trade-offs and consequences",
    "",
    ...list(dossier.reasoning.tradeoffs),
    "",
    "## Evidence",
    "",
    ...(dossier.evidence.length === 0
      ? ["No external or supplied evidence was recorded."]
      : dossier.evidence.map((item) => `- **${item.strength}:** ${item.claim} — ${item.source}`)),
    "",
    "## Uncertainty and unresolved questions",
    "",
    ...list([
      ...dossier.uncertainty.sources,
      ...dossier.reasoning.unresolvedQuestions,
      ...dossier.uncertainty.unscoredBranchIds.map((id) => `Unscored branch: ${id}`),
    ]),
    "",
    "## Deliberation record",
    "",
    `- Branches considered: ${dossier.exploration.branchCount}`,
    `- Questions explored: ${dossier.exploration.questionCount}`,
    `- Evaluated conclusions: ${dossier.stats.evaluatedLeaves}`,
    `- Run ID: ${dossier.runId}`,
    "",
    "## Approval",
    "",
    `Current status: ${dossier.approval.status}. Decision Deliberation does not execute this recommendation.`,
    "",
  );

  return `${lines.join("\n").trimEnd()}\n`;
}
