import {
  BaselineDecisionSchema,
  type BaselineDecision,
  type DecisionRequest,
} from "../domain/schemas.js";
import type { AgentProvider } from "../agents/provider.js";
import {
  structuredCall,
  type AgentCallArtifact,
} from "../agents/structured-call.js";

export type BaselineArm = "one_shot" | "sequential_grill";

export interface BaselineSeriesOptions {
  provider: AgentProvider;
  request: DecisionRequest;
  arm: BaselineArm;
  rounds: number;
  maxAttemptsPerCall?: number;
  callIdPrefix?: string;
}

export interface BaselineSeriesResult {
  arm: BaselineArm;
  rounds: number;
  calls: number;
  decision: BaselineDecision;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
    latencyMs: number;
  };
  artifacts: AgentCallArtifact<BaselineDecision>[];
}

export const BASELINE_DECISION_CONTRACT =
  "Return BaselineDecisionSchema v1. Recommend one decision, rank at least one alternative, and state reasoning, assumptions, and uncertainty.";

function instruction(arm: BaselineArm, round: number): string {
  if (arm === "one_shot") {
    return "Produce the strongest independent answer you can in one pass. Address every declared criterion and constraint.";
  }
  if (round === 1) {
    return "Produce an initial decision. Make the reasoning, alternatives, assumptions, and uncertainties explicit.";
  }
  return "Critically grill the previous decision for missing possibilities, weak assumptions, downstream consequences, and constraint failures, then replace it with a stronger complete decision.";
}

function sumUsage(artifacts: readonly AgentCallArtifact[]): BaselineSeriesResult["usage"] {
  const costs = artifacts.map((artifact) => artifact.response?.usage?.costUsd);
  return {
    inputTokens: artifacts.reduce(
      (sum, artifact) => sum + (artifact.response?.usage?.inputTokens ?? 0),
      0,
    ),
    outputTokens: artifacts.reduce(
      (sum, artifact) => sum + (artifact.response?.usage?.outputTokens ?? 0),
      0,
    ),
    costUsd: costs.every((cost): cost is number => cost !== undefined)
      ? costs.reduce((sum, cost) => sum + cost, 0)
      : null,
    latencyMs: artifacts.reduce(
      (sum, artifact) => sum + (artifact.response?.usage?.latencyMs ?? 0),
      0,
    ),
  };
}

export async function runBaselineSeries(
  options: BaselineSeriesOptions,
): Promise<BaselineSeriesResult> {
  if (!Number.isInteger(options.rounds) || options.rounds < 1 || options.rounds > 50) {
    throw new RangeError("rounds must be an integer from 1 to 50");
  }
  if (options.arm === "one_shot" && options.rounds !== 1) {
    throw new Error("one_shot requires exactly one round");
  }
  if (options.arm === "sequential_grill" && options.rounds < 2) {
    throw new Error("sequential_grill requires at least two rounds");
  }

  const artifacts: AgentCallArtifact<BaselineDecision>[] = [];
  let previousDecision: BaselineDecision | null = null;
  const maxAttempts = options.maxAttemptsPerCall ?? 2;
  const prefix = options.callIdPrefix ?? `baseline.${options.arm}`;

  for (let round = 1; round <= options.rounds; round += 1) {
    const result = await structuredCall({
      provider: options.provider,
      request: (attempt, validationErrors) => ({
        callId: `${prefix}.round-${round}.attempt-${attempt}`,
        role: "baseline-designer",
        input: {
          decision: options.request,
          arm: options.arm,
          round,
          totalRounds: options.rounds,
          instruction: instruction(options.arm, round),
          previousDecision,
        },
        contract: BASELINE_DECISION_CONTRACT,
        attempt,
        validationErrors,
      }),
      schema: BaselineDecisionSchema,
      maxAttempts,
    });
    artifacts.push(...result.artifacts);
    previousDecision = result.value;
  }

  if (previousDecision === null) throw new Error("baseline series produced no decision");
  return {
    arm: options.arm,
    rounds: options.rounds,
    calls: artifacts.length,
    decision: previousDecision,
    usage: sumUsage(artifacts),
    artifacts,
  };
}
