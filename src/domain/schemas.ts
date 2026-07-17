import { z } from "zod";

const NonEmptyString = z.string().trim().min(1);
const StringList = z.array(NonEmptyString);
const Confidence = z.number().min(0).max(1);

export const DecisionCriterionSchema = z
  .object({
    key: NonEmptyString.regex(/^[a-z][a-z0-9_-]*$/),
    label: NonEmptyString,
    description: NonEmptyString,
    weight: z.number().positive(),
    zeroAnchor: NonEmptyString,
    oneAnchor: NonEmptyString,
  })
  .strict();

export const DecisionRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: NonEmptyString,
    decisionStatement: NonEmptyString,
    context: z.string(),
    scope: z
      .object({
        inScope: StringList,
        outOfScope: StringList,
        constraints: StringList,
      })
      .strict(),
    criteria: z.array(DecisionCriterionSchema).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const keys = value.criteria.map((criterion) => criterion.key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["criteria"],
        message: "criterion keys must be unique",
      });
    }
  });

export const DecisionInterviewTurnSchema = z
  .object({
    schemaVersion: z.literal(1),
    reflection: NonEmptyString,
    ready: z.boolean(),
    question: NonEmptyString.nullable(),
    rationale: NonEmptyString.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.ready && (value.question !== null || value.rationale !== null)) {
      context.addIssue({
        code: "custom",
        path: ["question"],
        message: "ready interview turns must not contain another question",
      });
    }
    if (!value.ready && (value.question === null || value.rationale === null)) {
      context.addIssue({
        code: "custom",
        path: ["question"],
        message: "open interview turns require one question and rationale",
      });
    }
  });

export const BootstrapConfigurationSchema = z
  .object({
    schemaVersion: z.literal(1),
    completion: z.enum(["coverage", "budget"]),
    traversal: z.enum(["bfs", "dfs"]),
    questionPipeline: z
      .object({
        proposerCount: z.number().int().min(1).max(12),
        reviewerCount: z.literal(1),
        synthesizerCount: z.literal(1),
      })
      .strict(),
    options: z
      .object({
        min: z.number().int().min(2),
        target: z.number().int().min(2),
        max: z.number().int().min(2).max(20),
      })
      .strict(),
    limits: z
      .object({
        maxDepth: z.number().int().min(1),
        maxNodes: z.number().int().min(3),
        maxQuestions: z.number().int().min(1),
        maxAgentCalls: z.number().int().min(1),
        maxWallTimeMs: z.number().int().positive().optional(),
      })
      .strict(),
    concurrency: z.number().int().min(1).max(64),
    maxAttemptsPerCall: z.number().int().min(1).max(2),
    evaluatorCount: z.number().int().min(1).max(9),
    confidencePenalty: z.number().min(0).max(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (!(value.options.min <= value.options.target && value.options.target <= value.options.max)) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "options must satisfy min <= target <= max",
      });
    }
  });

export const DEFAULT_BOOTSTRAP_CONFIGURATION = BootstrapConfigurationSchema.parse({
  schemaVersion: 1,
  completion: "coverage",
  traversal: "bfs",
  questionPipeline: {
    proposerCount: 3,
    reviewerCount: 1,
    synthesizerCount: 1,
  },
  options: { min: 2, target: 3, max: 5 },
  limits: {
    maxDepth: 4,
    maxNodes: 500,
    maxQuestions: 200,
    maxAgentCalls: 1_000,
  },
  concurrency: 4,
  maxAttemptsPerCall: 2,
  evaluatorCount: 1,
  confidencePenalty: 0,
});

export const CandidateOptionSchema = z
  .object({
    key: NonEmptyString.regex(/^[a-z][a-z0-9_-]*$/),
    label: NonEmptyString,
    description: NonEmptyString,
    expectedConsequences: StringList,
    assumptions: StringList,
    tradeoffs: StringList,
  })
  .strict();

export const BranchConclusionSchema = z
  .object({
    summary: NonEmptyString,
    recommendation: NonEmptyString,
    conditions: StringList,
    caveats: StringList,
    unresolvedQuestions: StringList,
  })
  .strict();

export const ExpansionResolutionSchema = z
  .object({
    type: z.literal("expand"),
    question: z
      .object({
        semanticKey: NonEmptyString.regex(/^[a-z][a-z0-9_.-]*$/),
        text: NonEmptyString,
        rationale: NonEmptyString,
        resolves: StringList,
        options: z.array(CandidateOptionSchema).min(2),
        recommendation: z
          .object({
            optionKey: NonEmptyString,
            reason: NonEmptyString,
            confidence: Confidence,
          })
          .strict(),
        coverageRationale: NonEmptyString,
        atomicityRationale: NonEmptyString,
        exclusivityRationale: NonEmptyString,
      })
      .strict(),
  })
  .strict();

export const ConclusionResolutionSchema = z
  .object({
    type: z.literal("conclude"),
    conclusion: BranchConclusionSchema,
  })
  .strict();

export const FinalResolutionSchema = z.discriminatedUnion("type", [
  ExpansionResolutionSchema,
  ConclusionResolutionSchema,
]);

export const QuestionProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    resolution: FinalResolutionSchema,
  })
  .strict();

export const CoverageReviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    findings: z
      .object({
        missingAngles: StringList,
        overlaps: StringList,
        atomicityIssues: StringList,
        exclusivityIssues: StringList,
        pathContextRisks: StringList,
      })
      .strict(),
    synthesisInstructions: StringList,
    preferredProposalIndexes: z.array(z.number().int().min(0)),
  })
  .strict();

export const FinalSynthesisSchema = z
  .object({
    schemaVersion: z.literal(1),
    resolution: FinalResolutionSchema,
  })
  .strict();

export const EvidenceItemSchema = z
  .object({
    claim: NonEmptyString,
    source: NonEmptyString,
    strength: z.enum(["weak", "moderate", "strong"]),
  })
  .strict();

export const CriterionScoreSchema = z
  .object({
    criterionKey: NonEmptyString,
    score: z.number().min(0).max(1),
    rationale: NonEmptyString,
  })
  .strict();

export const BranchEvaluationSchema = z
  .object({
    schemaVersion: z.literal(1),
    conclusion: BranchConclusionSchema,
    criterionScores: z.array(CriterionScoreSchema).min(1),
    confidence: Confidence,
    evidence: z.array(EvidenceItemSchema),
    assumptions: StringList,
    caveats: StringList,
  })
  .strict();

export const BaselineDecisionSchema = z
  .object({
    schemaVersion: z.literal(1),
    recommendation: NonEmptyString,
    reasoning: StringList.min(1),
    rankedAlternatives: z
      .array(
        z
          .object({
            label: NonEmptyString,
            rationale: NonEmptyString,
          })
          .strict(),
      )
      .min(1),
    assumptions: StringList,
    uncertainties: StringList,
  })
  .strict();

export const ApprovalSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    decidedBy: NonEmptyString,
    notes: z.string(),
    decidedAt: z.string().datetime(),
  })
  .strict();

export type DecisionCriterion = z.infer<typeof DecisionCriterionSchema>;
export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;
export type DecisionInterviewTurn = z.infer<typeof DecisionInterviewTurnSchema>;
export type BootstrapConfiguration = z.infer<typeof BootstrapConfigurationSchema>;
export type CandidateOption = z.infer<typeof CandidateOptionSchema>;
export type BranchConclusion = z.infer<typeof BranchConclusionSchema>;
export type FinalResolution = z.infer<typeof FinalResolutionSchema>;
export type QuestionProposal = z.infer<typeof QuestionProposalSchema>;
export type CoverageReview = z.infer<typeof CoverageReviewSchema>;
export type FinalSynthesis = z.infer<typeof FinalSynthesisSchema>;
export type BranchEvaluation = z.infer<typeof BranchEvaluationSchema>;
export type BaselineDecision = z.infer<typeof BaselineDecisionSchema>;
export type Approval = z.infer<typeof ApprovalSchema>;
