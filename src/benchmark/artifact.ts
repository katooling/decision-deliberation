import { z } from "zod";

import type { DecisionDossier } from "../core/dossier.js";
import type { BaselineDecision } from "../domain/schemas.js";

const NonEmptyString = z.string().trim().min(1);

export const BenchmarkDecisionArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    recommendation: NonEmptyString,
    reasoning: z.array(NonEmptyString),
    rankedAlternatives: z.array(
      z.object({ label: NonEmptyString, rationale: NonEmptyString }).strict(),
    ),
    assumptions: z.array(NonEmptyString),
    uncertainties: z.array(NonEmptyString),
  })
  .strict();

export type BenchmarkDecisionArtifact = z.infer<typeof BenchmarkDecisionArtifactSchema>;

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export function normalizeBaselineArtifact(
  decision: BaselineDecision,
): BenchmarkDecisionArtifact {
  return BenchmarkDecisionArtifactSchema.parse({
    schemaVersion: 1,
    recommendation: decision.recommendation,
    reasoning: decision.reasoning,
    rankedAlternatives: decision.rankedAlternatives,
    assumptions: decision.assumptions,
    uncertainties: decision.uncertainties,
  });
}

export function normalizeDossierArtifact(
  dossier: DecisionDossier,
): BenchmarkDecisionArtifact {
  const recommendation = dossier.recommendation;
  const pathReasoning = recommendation?.path.map(
    (step) => `${step.questionText} → ${step.optionLabel}: ${step.optionDescription}`,
  ) ?? [];
  return BenchmarkDecisionArtifactSchema.parse({
    schemaVersion: 1,
    recommendation: recommendation?.recommendation ?? "No scored recommendation is available.",
    reasoning: unique([
      ...(recommendation === null ? [] : [recommendation.summary]),
      ...pathReasoning,
      ...(recommendation?.conditions ?? []),
      ...dossier.reasoning.tradeoffs,
    ]),
    rankedAlternatives: dossier.rankedAlternatives.map((alternative) => ({
      label: alternative.recommendation,
      rationale: alternative.summary,
    })),
    assumptions: unique(dossier.reasoning.assumptions),
    uncertainties: unique([
      ...dossier.uncertainty.sources,
      ...dossier.reasoning.unresolvedQuestions,
    ]),
  });
}
