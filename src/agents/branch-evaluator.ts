import {
  BranchEvaluationSchema,
  type BootstrapConfiguration,
  type BranchEvaluation,
  type DecisionRequest,
} from "../domain/schemas.js";
import type { BranchNode } from "../domain/state.js";
import { createAgentCallId } from "../core/ids.js";
import type { AgentProvider, AgentRequest } from "./provider.js";
import {
  structuredCall,
  type AgentCallArtifact,
} from "./structured-call.js";

export const BRANCH_EVALUATION_CONTRACT =
  "Return BranchEvaluationSchema v1 as raw JSON or inside <result>...</result>. " +
  "Score every supplied criterion exactly once. Judge the complete ordered path, not only its final choice.";

export interface BranchEvaluationPanelOptions {
  provider: AgentProvider;
  runId: string;
  request: DecisionRequest;
  config: BootstrapConfiguration;
  branch: BranchNode;
  onArtifact?: (artifact: AgentCallArtifact<BranchEvaluation>) => void | Promise<void>;
}

export interface BranchEvaluationPanelResult {
  evaluations: BranchEvaluation[];
  artifacts: AgentCallArtifact<BranchEvaluation>[];
}

function validateCriteria(
  evaluation: BranchEvaluation,
  request: DecisionRequest,
): string[] {
  const expected = request.criteria.map((criterion) => criterion.key).sort();
  const actual = evaluation.criterionScores.map((criterion) => criterion.criterionKey).sort();
  if (new Set(actual).size !== actual.length) {
    return ["criterion scores must not contain duplicate keys"];
  }
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    return [
      `criterion scores must contain exactly: ${expected.join(", ")}; received: ${actual.join(", ")}`,
    ];
  }
  return [];
}

export async function runBranchEvaluationPanel(
  options: BranchEvaluationPanelOptions,
): Promise<BranchEvaluationPanelResult> {
  const tasks = Array.from({ length: options.config.evaluatorCount }, (_, ordinal) =>
    structuredCall({
      provider: options.provider,
      request: (attempt, validationErrors): AgentRequest => ({
        callId: createAgentCallId(
          options.runId,
          options.branch.id,
          "branch-evaluator",
          ordinal,
          attempt,
        ),
        role: "branch-evaluator",
        input: {
          decision: options.request,
          branch: options.branch,
          evaluatorOrdinal: ordinal,
        },
        contract: BRANCH_EVALUATION_CONTRACT,
        attempt,
        validationErrors,
      }),
      schema: BranchEvaluationSchema,
      maxAttempts: options.config.maxAttemptsPerCall,
      tagNames: ["result", "branch_evaluation"],
      semanticValidate: (evaluation) => validateCriteria(evaluation, options.request),
      ...(options.onArtifact === undefined ? {} : { onArtifact: options.onArtifact }),
    }).then((result) => ({ ordinal, result })),
  );

  const results = (await Promise.all(tasks)).sort(
    (left, right) => left.ordinal - right.ordinal,
  );
  return {
    evaluations: results.map(({ result }) => result.value),
    artifacts: results.flatMap(({ result }) => result.artifacts),
  };
}
