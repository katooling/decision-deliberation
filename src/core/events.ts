import type {
  Approval,
  BootstrapConfiguration,
  BranchConclusion,
  BranchEvaluation,
  DecisionRequest,
} from "../domain/schemas.js";
import {
  BootstrapConfigurationSchema,
  BranchEvaluationSchema,
  DecisionRequestSchema,
} from "../domain/schemas.js";
import type {
  BranchNode,
  BranchTerminalReason,
  DecisionState,
  MaterializedExpansion,
  RunCompletion,
  UsageCounters,
} from "../domain/state.js";
import { branchStateHash, createEvaluationId, createEventId, ROOT_BRANCH_ID } from "./ids.js";

interface EventEnvelope {
  schemaVersion: 1;
  eventId: string;
  sequence: number;
}

export type DecisionEventPayload =
  | {
      type: "run_created";
      runId: string;
      request: DecisionRequest;
      config: BootstrapConfiguration;
      rootBranch: BranchNode;
    }
  | { type: "branch_expansion_started"; branchId: string }
  | { type: "branch_expanded"; materialized: MaterializedExpansion }
  | { type: "branch_concluded"; branchId: string; conclusion: BranchConclusion }
  | {
      type: "branch_closed";
      branchId: string;
      reason: Exclude<BranchTerminalReason, "resolved" | "failed">;
    }
  | { type: "branch_failed"; branchId: string; failure: string }
  | {
      type: "branch_evaluated";
      branchId: string;
      evaluationId: string;
      evaluatorOrdinal: number;
      evaluation: BranchEvaluation;
    }
  | { type: "usage_recorded"; delta: Partial<UsageCounters> }
  | { type: "run_completed"; completion: RunCompletion }
  | { type: "approval_recorded"; approval: Approval };

export type DecisionEvent = DecisionEventPayload & EventEnvelope;

function envelope(
  runId: string,
  sequence: number,
  payload: DecisionEventPayload,
): DecisionEvent {
  return {
    ...payload,
    schemaVersion: 1,
    sequence,
    eventId: createEventId(runId, sequence, payload),
  } as DecisionEvent;
}

export function createRunCreatedEvent(
  runId: string,
  request: DecisionRequest,
  config: BootstrapConfiguration,
): DecisionEvent {
  const parsedRequest = DecisionRequestSchema.parse(request);
  const parsedConfig = BootstrapConfigurationSchema.parse(config);
  const rootBranch: BranchNode = {
    id: ROOT_BRANCH_ID,
    parentId: null,
    depth: 0,
    path: [],
    branchStateHash: branchStateHash([]),
    status: "frontier",
    createdOrdinal: 0,
    selectedBy: null,
    expandedByQuestionId: null,
    terminalReason: null,
    conclusion: null,
    evaluations: [],
    failure: null,
  };
  return envelope(runId, 1, {
    type: "run_created",
    runId,
    request: parsedRequest,
    config: parsedConfig,
    rootBranch,
  });
}

export function createDecisionEvent(
  state: DecisionState,
  payload: Exclude<DecisionEventPayload, { type: "run_created" }>,
): DecisionEvent {
  return envelope(state.runId, state.eventsApplied + 1, payload);
}

export function createBranchExpansionStartedEvent(
  state: DecisionState,
  branchId: string,
): DecisionEvent {
  return createDecisionEvent(state, { type: "branch_expansion_started", branchId });
}

export function createBranchConcludedEvent(
  state: DecisionState,
  branchId: string,
  conclusion: BranchConclusion,
): DecisionEvent {
  return createDecisionEvent(state, { type: "branch_concluded", branchId, conclusion });
}

export function createBranchClosedEvent(
  state: DecisionState,
  branchId: string,
  reason: Exclude<BranchTerminalReason, "resolved" | "failed">,
): DecisionEvent {
  return createDecisionEvent(state, { type: "branch_closed", branchId, reason });
}

export function createBranchFailedEvent(
  state: DecisionState,
  branchId: string,
  failure: string,
): DecisionEvent {
  return createDecisionEvent(state, { type: "branch_failed", branchId, failure });
}

export function createBranchEvaluatedEvent(
  state: DecisionState,
  branchId: string,
  evaluatorOrdinal: number,
  evaluation: BranchEvaluation,
): DecisionEvent {
  const parsed = BranchEvaluationSchema.parse(evaluation);
  return createDecisionEvent(state, {
    type: "branch_evaluated",
    branchId,
    evaluationId: createEvaluationId(branchId, evaluatorOrdinal, parsed),
    evaluatorOrdinal,
    evaluation: parsed,
  });
}

export function createUsageRecordedEvent(
  state: DecisionState,
  delta: Partial<UsageCounters>,
): DecisionEvent {
  return createDecisionEvent(state, { type: "usage_recorded", delta });
}

export function createRunCompletedEvent(
  state: DecisionState,
  completion: RunCompletion,
): DecisionEvent {
  return createDecisionEvent(state, { type: "run_completed", completion });
}

export function createApprovalRecordedEvent(
  state: DecisionState,
  approval: Approval,
): DecisionEvent {
  return createDecisionEvent(state, { type: "approval_recorded", approval });
}
