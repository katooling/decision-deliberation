import type { DecisionDossier } from "../core/dossier.js";

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function renderDossierMarkdown(dossier: DecisionDossier): string {
  const lines = [
    `# ${dossier.title}`,
    "",
    dossier.decisionStatement,
    "",
    `**Completeness:** ${dossier.completeness}`,
    `**Approval:** ${dossier.approval.status}`,
    "",
    "## Recommendation",
    "",
  ];

  if (!dossier.recommendation) {
    lines.push("No scored recommendation is available.", "");
  } else {
    lines.push(
      `**${dossier.recommendation.recommendation}**`,
      "",
      dossier.recommendation.summary,
      "",
      `Score: ${percent(dossier.recommendation.score)}; confidence: ${percent(dossier.recommendation.confidence)}.`,
      "",
      "### Winning path",
      "",
      ...dossier.recommendation.path.map(
        (step, index) =>
          `${index + 1}. **${step.questionText}** → ${step.optionLabel}${step.wasQuestionRecommendation ? " _(locally recommended)_" : ""}`,
      ),
      "",
    );
  }

  lines.push(
    "## Ranked alternatives",
    "",
    "| Rank | Recommendation | Score | Confidence | Branch |",
    "|---:|---|---:|---:|---|",
    ...dossier.rankedAlternatives.map(
      (alternative) =>
        `| ${alternative.rank} | ${escapeCell(alternative.recommendation)} | ${percent(alternative.score)} | ${percent(alternative.confidence)} | ${alternative.branchId} |`,
    ),
    "",
    "## Exploration",
    "",
    `- Branches: ${dossier.exploration.branchCount}`,
    `- Questions: ${dossier.exploration.questionCount}`,
    `- Maximum depth: ${dossier.exploration.maxDepth}`,
    `- Evaluated leaves: ${dossier.stats.evaluatedLeaves}`,
    `- Agent calls: ${dossier.stats.agentCalls}`,
    "",
  );

  if (dossier.uncertainty.sources.length > 0 || dossier.uncertainty.unscoredBranchIds.length > 0) {
    lines.push(
      "## Uncertainty",
      "",
      ...dossier.uncertainty.sources.map((source) => `- ${source}`),
      ...dossier.uncertainty.unscoredBranchIds.map(
        (branchId) => `- Unscored branch: ${branchId}`,
      ),
      "",
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
