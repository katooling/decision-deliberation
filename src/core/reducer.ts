import type { DecisionState, UsageCounters } from "../domain/state.js";
import type { DecisionEvent } from "./events.js";
import { createEventId } from "./ids.js";

const ZERO_USAGE: UsageCounters = {
  questions: 0,
  agentCalls: 0,
  retries: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  wallTimeMs: 0,
};

function requireBranch(state: DecisionState, branchId: string) {
  const branch = state.branches[branchId];
  if (!branch) throw new Error(`Unknown branch: ${branchId}`);
  return branch;
}

function verifyEnvelope(state: DecisionState | undefined, event: DecisionEvent): void {
  const expectedSequence = state ? state.eventsApplied + 1 : 1;
  if (event.sequence !== expectedSequence) {
    throw new Error(`Expected event sequence ${expectedSequence}, got ${event.sequence}`);
  }
  const { eventId: _eventId, schemaVersion: _schemaVersion, sequence: _sequence, ...payload } = event;
  const runId = state?.runId ?? (event.type === "run_created" ? event.runId : "");
  const expectedId = createEventId(runId, event.sequence, payload);
  if (event.eventId !== expectedId) {
    throw new Error(`Event ID mismatch at sequence ${event.sequence}`);
  }
}

function finish(state: DecisionState, event: DecisionEvent): DecisionState {
  return { ...state, eventsApplied: event.sequence, lastEventId: event.eventId };
}

export function applyEvent(
  current: DecisionState | undefined,
  event: DecisionEvent,
): DecisionState {
  verifyEnvelope(current, event);

  if (event.type === "run_created") {
    if (current) throw new Error("run_created must be the first event");
    return {
      schemaVersion: 1,
      runId: event.runId,
      request: event.request,
      config: event.config,
      rootBranchId: event.rootBranch.id,
      branches: { [event.rootBranch.id]: event.rootBranch },
      expansions: {},
      edges: [],
      usage: { ...ZERO_USAGE },
      completion: null,
      approval: null,
      eventsApplied: event.sequence,
      lastEventId: event.eventId,
    };
  }

  if (!current) throw new Error(`${event.type} cannot precede run_created`);
  if (current.completion && event.type !== "approval_recorded") {
    throw new Error("Cannot mutate a completed run");
  }

  switch (event.type) {
    case "branch_expansion_started": {
      const branch = requireBranch(current, event.branchId);
      if (branch.status !== "frontier") {
        throw new Error(`Branch ${branch.id} is not frontier`);
      }
      return finish(
        {
          ...current,
          branches: {
            ...current.branches,
            [branch.id]: { ...branch, status: "expanding" },
          },
        },
        event,
      );
    }
    case "branch_expanded": {
      const { materialized } = event;
      const parent = requireBranch(current, materialized.parentBranchId);
      if (parent.status !== "frontier" && parent.status !== "expanding") {
        throw new Error(`Branch ${parent.id} cannot be expanded from ${parent.status}`);
      }
      if (current.expansions[materialized.expansion.id]) {
        throw new Error(`Expansion already exists: ${materialized.expansion.id}`);
      }
      const branches = { ...current.branches };
      for (const child of materialized.childBranches) {
        if (branches[child.id]) throw new Error(`Branch already exists: ${child.id}`);
        branches[child.id] = child;
      }
      branches[parent.id] = {
        ...parent,
        status: "expanded",
        expandedByQuestionId: materialized.expansion.questionId,
      };
      return finish(
        {
          ...current,
          branches,
          expansions: {
            ...current.expansions,
            [materialized.expansion.id]: materialized.expansion,
          },
          edges: [...current.edges, ...materialized.edges],
          usage: { ...current.usage, questions: current.usage.questions + 1 },
        },
        event,
      );
    }
    case "branch_concluded": {
      const branch = requireBranch(current, event.branchId);
      if (branch.status !== "frontier" && branch.status !== "expanding") {
        throw new Error(`Branch ${branch.id} cannot conclude from ${branch.status}`);
      }
      return finish(
        {
          ...current,
          branches: {
            ...current.branches,
            [branch.id]: {
              ...branch,
              status: "terminal",
              terminalReason: "resolved",
              conclusion: event.conclusion,
            },
          },
        },
        event,
      );
    }
    case "branch_closed": {
      const branch = requireBranch(current, event.branchId);
      if (branch.status !== "frontier" && branch.status !== "expanding") {
        throw new Error(`Branch ${branch.id} cannot close from ${branch.status}`);
      }
      return finish(
        {
          ...current,
          branches: {
            ...current.branches,
            [branch.id]: {
              ...branch,
              status: "terminal",
              terminalReason: event.reason,
            },
          },
        },
        event,
      );
    }
    case "branch_failed": {
      const branch = requireBranch(current, event.branchId);
      if (branch.status === "expanded" || branch.status === "terminal") {
        throw new Error(`Branch ${branch.id} cannot fail from ${branch.status}`);
      }
      return finish(
        {
          ...current,
          branches: {
            ...current.branches,
            [branch.id]: {
              ...branch,
              status: "failed",
              terminalReason: "failed",
              failure: event.failure,
            },
          },
        },
        event,
      );
    }
    case "branch_evaluated": {
      const branch = requireBranch(current, event.branchId);
      if (branch.status !== "terminal") {
        throw new Error(`Only terminal branches can be evaluated: ${branch.id}`);
      }
      if (branch.evaluations.some((item) => item.evaluatorOrdinal === event.evaluatorOrdinal)) {
        throw new Error(`Evaluator ordinal ${event.evaluatorOrdinal} already recorded for ${branch.id}`);
      }
      return finish(
        {
          ...current,
          branches: {
            ...current.branches,
            [branch.id]: {
              ...branch,
              evaluations: [
                ...branch.evaluations,
                {
                  id: event.evaluationId,
                  evaluatorOrdinal: event.evaluatorOrdinal,
                  evaluation: event.evaluation,
                },
              ].sort((a, b) => a.evaluatorOrdinal - b.evaluatorOrdinal),
            },
          },
        },
        event,
      );
    }
    case "usage_recorded": {
      const usage = { ...current.usage };
      for (const key of Object.keys(event.delta) as (keyof UsageCounters)[]) {
        const increment = event.delta[key];
        if (increment === undefined || !Number.isFinite(increment) || increment < 0) {
          throw new Error(`Invalid usage delta for ${key}`);
        }
        usage[key] += increment;
      }
      return finish({ ...current, usage }, event);
    }
    case "run_completed":
      if (current.completion) throw new Error("Run is already completed");
      return finish({ ...current, completion: event.completion }, event);
    case "approval_recorded":
      if (!current.completion) throw new Error("Cannot approve an incomplete run");
      if (current.approval) throw new Error("Human Approval has already been recorded");
      return finish({ ...current, approval: event.approval }, event);
  }
}

export function replay(events: Iterable<DecisionEvent>): DecisionState {
  let state: DecisionState | undefined;
  for (const event of events) state = applyEvent(state, event);
  if (!state) throw new Error("Cannot replay an empty event stream");
  return state;
}

export const replayEvents = replay;
