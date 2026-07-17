import {
  CoverageReviewSchema,
  FinalSynthesisSchema,
  QuestionProposalSchema,
  type BootstrapConfiguration,
  type CoverageReview,
  type FinalResolution,
  type FinalSynthesis,
  type QuestionProposal,
} from "../domain/schemas.js";
import type { AgentProvider, AgentRequest, AgentRole } from "./provider.js";
import {
  StructuredOutputError,
  structuredCall,
  type AgentCallArtifact,
} from "./structured-call.js";

export type QuestionCallIdFactory = (
  role: AgentRole,
  ordinal: number,
  attempt: number,
) => string;

export interface QuestionPipelineOptions {
  provider: AgentProvider;
  branchInput: unknown;
  config: BootstrapConfiguration;
  callIdPrefix?: string;
  callIdFactory?: QuestionCallIdFactory;
  onArtifact?: (artifact: AgentCallArtifact) => void | Promise<void>;
}

export interface QuestionPipelineResult {
  resolution: FinalResolution;
  proposals: QuestionProposal[];
  review: CoverageReview;
  artifacts: AgentCallArtifact[];
}

export interface OptionBounds {
  min: number;
  max: number;
}

export const QUESTION_PROPOSAL_CONTRACT =
  "Return QuestionProposalSchema v1 as raw JSON or inside <result>...</result>. " +
  "Options must be atomic and mutually exclusive. Do not assign controller IDs.";

export const COVERAGE_REVIEW_CONTRACT =
  "Return CoverageReviewSchema v1 as raw JSON or inside <result>...</result>. " +
  "Review importance, omissions, overlap, atomicity, exclusivity, and path-context risks.";

export const FINAL_SYNTHESIS_CONTRACT =
  "Return FinalSynthesisSchema v1 as raw JSON or inside <result>...</result>. " +
  "Return exactly one expansion or conclusion. Expansion option keys must be unique and the recommendation must name an option.";

/** Checks the final expansion invariants that Zod alone cannot express. */
export function validateFinalSynthesis(
  synthesis: FinalSynthesis,
  bounds: OptionBounds,
): string[] {
  if (synthesis.resolution.type === "conclude") return [];

  const { options, recommendation } = synthesis.resolution.question;
  const violations: string[] = [];
  if (options.length < bounds.min) {
    violations.push(`question must contain at least ${bounds.min} options; received ${options.length}`);
  }
  if (options.length > bounds.max) {
    violations.push(`question must contain at most ${bounds.max} options; received ${options.length}`);
  }

  const keys = options.map((option) => option.key);
  if (new Set(keys).size !== keys.length) {
    violations.push("question option keys must be unique");
  }
  if (!keys.includes(recommendation.optionKey)) {
    violations.push(
      `recommendation optionKey ${JSON.stringify(recommendation.optionKey)} does not identify an option`,
    );
  }
  return violations;
}

function defaultCallIdFactory(prefix: string): QuestionCallIdFactory {
  return (role, ordinal, attempt) => `${prefix}.${role}.${ordinal}.attempt-${attempt}`;
}

function requestFactory(
  role: AgentRole,
  ordinal: number,
  input: unknown,
  contract: string,
  callIdFactory: QuestionCallIdFactory,
): (attempt: number, validationErrors: string[]) => AgentRequest {
  return (attempt, validationErrors) => ({
    callId: callIdFactory(role, ordinal, attempt),
    role,
    input,
    contract,
    attempt,
    validationErrors,
  });
}

/**
 * Run independent proposers in parallel, restore ordinal order, then hand the
 * complete panel to one reviewer and one synthesizer through the coordinator.
 */
export async function runQuestionPipeline(
  options: QuestionPipelineOptions,
): Promise<QuestionPipelineResult> {
  const { config } = options;
  const callIdFactory =
    options.callIdFactory ?? defaultCallIdFactory(options.callIdPrefix ?? "question-pipeline");
  const bounds = { min: config.options.min, max: config.options.max };

  const proposerTasks = Array.from(
    { length: config.questionPipeline.proposerCount },
    (_, ordinal) => {
      const input = {
        branch: options.branchInput,
        proposerOrdinal: ordinal,
        optionBounds: { ...bounds, target: config.options.target },
      };
      return structuredCall({
        provider: options.provider,
        request: requestFactory(
          "question-proposer",
          ordinal,
          input,
          QUESTION_PROPOSAL_CONTRACT,
          callIdFactory,
        ),
        schema: QuestionProposalSchema,
        maxAttempts: config.maxAttemptsPerCall,
        tagNames: ["result", "question_result", "question_proposal"],
        ...(options.onArtifact === undefined ? {} : { onArtifact: options.onArtifact }),
      }).then((result) => ({ ordinal, result }));
    },
  );

  const settledProposers = await Promise.allSettled(proposerTasks);
  const proposerFailures = settledProposers.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (proposerFailures.length > 0) {
    const completedArtifacts = settledProposers.flatMap((result) =>
      result.status === "fulfilled" ? result.value.result.artifacts : [],
    );
    const failedArtifacts = proposerFailures.flatMap((result) =>
      result.reason instanceof StructuredOutputError ? result.reason.artifacts : [],
    );
    const violations = proposerFailures.flatMap((result) =>
      result.reason instanceof StructuredOutputError
        ? result.reason.violations
        : [result.reason instanceof Error ? result.reason.message : String(result.reason)],
    );
    throw new StructuredOutputError(
      `${proposerFailures.length} question proposer(s) failed`,
      [...completedArtifacts, ...failedArtifacts],
      violations,
    );
  }
  const proposerResults = settledProposers
    .map((result) => {
      if (result.status !== "fulfilled") throw new Error("unreachable rejected proposer");
      return result.value;
    })
    .sort(
    (left, right) => left.ordinal - right.ordinal,
  );
  const proposals = proposerResults.map(({ result }) => result.value);
  const proposerArtifacts = proposerResults.flatMap(({ result }) => result.artifacts);

  const reviewInput = {
    branch: options.branchInput,
    proposals,
    optionBounds: { ...bounds, target: config.options.target },
  };
  const reviewResult = await structuredCall({
    provider: options.provider,
    request: requestFactory(
      "coverage-reviewer",
      0,
      reviewInput,
      COVERAGE_REVIEW_CONTRACT,
      callIdFactory,
    ),
    schema: CoverageReviewSchema,
    maxAttempts: config.maxAttemptsPerCall,
    tagNames: ["result", "coverage_review"],
    ...(options.onArtifact === undefined ? {} : { onArtifact: options.onArtifact }),
  });

  const synthesisInput = {
    branch: options.branchInput,
    proposals,
    review: reviewResult.value,
    optionBounds: { ...bounds, target: config.options.target },
  };
  const synthesisResult = await structuredCall({
    provider: options.provider,
    request: requestFactory(
      "question-synthesizer",
      0,
      synthesisInput,
      FINAL_SYNTHESIS_CONTRACT,
      callIdFactory,
    ),
    schema: FinalSynthesisSchema,
    maxAttempts: config.maxAttemptsPerCall,
    tagNames: ["result", "final_synthesis", "question_result"],
    semanticValidate: (value) => validateFinalSynthesis(value, bounds),
    ...(options.onArtifact === undefined ? {} : { onArtifact: options.onArtifact }),
  });

  return {
    resolution: synthesisResult.value.resolution,
    proposals,
    review: reviewResult.value,
    artifacts: [
      ...proposerArtifacts,
      ...reviewResult.artifacts,
      ...synthesisResult.artifacts,
    ],
  };
}
