import {
  ApprovalSchema,
  BootstrapConfigurationSchema,
  DecisionRequestSchema,
  type Approval,
  type BootstrapConfiguration,
  type DecisionRequest,
} from "../domain/schemas.js";
import type {
  BranchNode,
  BranchTerminalReason,
  DecisionState,
  RunCompletion,
  UsageCounters,
} from "../domain/state.js";
import type { AgentProvider } from "../agents/provider.js";
import { runQuestionPipeline } from "../agents/question-pipeline.js";
import {
  runBranchEvaluationPanel,
} from "../agents/branch-evaluator.js";
import {
  StructuredOutputError,
  type AgentCallArtifact,
} from "../agents/structured-call.js";
import {
  applyEvent,
  assembleDossier,
  assertGraphInvariants,
  checkTermination,
  createApprovalRecordedEvent,
  createBranchClosedEvent,
  createBranchConcludedEvent,
  createBranchEvaluatedEvent,
  createBranchExpandedEvent,
  createBranchExpansionStartedEvent,
  createBranchFailedEvent,
  createRunCompletedEvent,
  createRunCreatedEvent,
  createRunId,
  createUsageRecordedEvent,
  ExpansionValidationError,
  replay,
  selectFrontier,
  type DecisionDossier,
  type DecisionEvent,
} from "../core/index.js";
import type { RunStore } from "../persistence/run-store.js";
import { mapConcurrentStable } from "./concurrency.js";

interface ExpansionSuccess {
  branchId: string;
  resolution: Awaited<ReturnType<typeof runQuestionPipeline>>["resolution"];
  artifacts: AgentCallArtifact[];
}

interface ExpansionFailure {
  branchId: string;
  error: Error;
  artifacts: AgentCallArtifact[];
}

type ExpansionOutcome = ExpansionSuccess | ExpansionFailure;

interface EvaluationSuccess {
  branchId: string;
  evaluations: Awaited<ReturnType<typeof runBranchEvaluationPanel>>["evaluations"];
  artifacts: AgentCallArtifact[];
}

interface EvaluationFailure {
  branchId: string;
  error: Error;
  artifacts: AgentCallArtifact[];
}

type EvaluationOutcome = EvaluationSuccess | EvaluationFailure;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function artifactsFromError(error: unknown): AgentCallArtifact[] {
  return error instanceof StructuredOutputError ? error.artifacts : [];
}

function usageFromArtifacts(artifacts: readonly AgentCallArtifact[]): Partial<UsageCounters> {
  return {
    agentCalls: artifacts.length,
    retries: artifacts.filter((artifact) => artifact.attempt > 1).length,
    inputTokens: artifacts.reduce(
      (sum, artifact) => sum + (artifact.response?.usage?.inputTokens ?? 0),
      0,
    ),
    outputTokens: artifacts.reduce(
      (sum, artifact) => sum + (artifact.response?.usage?.outputTokens ?? 0),
      0,
    ),
    costUsd: artifacts.reduce(
      (sum, artifact) => sum + (artifact.response?.usage?.costUsd ?? 0),
      0,
    ),
    wallTimeMs: artifacts.reduce(
      (sum, artifact) => sum + (artifact.response?.usage?.latencyMs ?? 0),
      0,
    ),
  };
}

function closeReason(
  completion: NonNullable<ReturnType<typeof checkTermination>["classification"]>,
  reasons: readonly string[],
): Exclude<BranchTerminalReason, "resolved" | "failed"> {
  if (reasons.includes("max_depth")) return "depth_limit";
  return completion === "partial_budget_exhausted" ? "budget_limit" : "safety_limit";
}

export interface DecisionEngineOptions {
  store: RunStore;
  provider: AgentProvider;
}

export class DecisionEngine {
  readonly store: RunStore;
  readonly provider: AgentProvider;

  constructor(options: DecisionEngineOptions) {
    this.store = options.store;
    this.provider = options.provider;
  }

  async create(
    requestInput: DecisionRequest,
    configInput: BootstrapConfiguration,
    runIdInput?: string,
  ): Promise<string> {
    const request = DecisionRequestSchema.parse(requestInput);
    const config = BootstrapConfigurationSchema.parse(configInput);
    const runId = runIdInput ?? createRunId(request, config);
    await this.store.createRun(runId, request, config);
    const event = createRunCreatedEvent(runId, request, config);
    await this.store.appendEvents(runId, [event]);
    const state = applyEvent(undefined, event);
    await this.store.writeSnapshot(runId, state);
    return runId;
  }

  async replay(runId: string): Promise<DecisionState> {
    const events: DecisionEvent[] = [];
    for await (const event of this.store.readEvents(runId)) {
      events.push(event as DecisionEvent);
    }
    const state = replay(events);
    assertGraphInvariants(state);
    return state;
  }

  async run(runId: string): Promise<DecisionDossier> {
    let state = await this.replay(runId);
    if (state.completion) {
      const dossier = assembleDossier(state);
      await this.store.writeDossier(runId, dossier);
      return dossier;
    }

    while (true) {
      const termination = checkTermination(state);
      if (termination.terminate) {
        if (!termination.classification) {
          throw new Error("termination requested without a classification");
        }
        const reason = closeReason(termination.classification, termination.reasons);
        for (const branchId of termination.branchesToClose) {
          state = await this.commit(
            state,
            createBranchClosedEvent(state, branchId, reason),
          );
        }
        const completion: RunCompletion = {
          classification: termination.classification,
          reasons: [...termination.reasons],
        };
        state = await this.evaluateTerminalBranches(state, completion);
        break;
      }

      const selected = selectFrontier(state);
      if (selected.length === 0) {
        throw new Error("no frontier work was selected before termination");
      }

      for (const branch of selected) {
        state = await this.commit(
          state,
          createBranchExpansionStartedEvent(state, branch.id),
        );
      }

      const branchSnapshots = selected.map((branch) => {
        const current = state.branches[branch.id];
        if (!current) throw new Error(`selected branch disappeared: ${branch.id}`);
        return structuredClone(current);
      });

      const outcomes = await mapConcurrentStable(
        branchSnapshots,
        state.config.concurrency,
        async (branch): Promise<ExpansionOutcome> => {
          try {
            const result = await runQuestionPipeline({
              provider: this.provider,
              branchInput: { decision: state.request, branch },
              config: state.config,
              callIdPrefix: `${state.runId}.${branch.id}`,
              onArtifact: (artifact) => this.store.writeCallArtifact(state.runId, artifact),
            });
            return {
              branchId: branch.id,
              resolution: result.resolution,
              artifacts: result.artifacts,
            };
          } catch (error) {
            return {
              branchId: branch.id,
              error: asError(error),
              artifacts: artifactsFromError(error),
            };
          }
        },
      );

      for (const outcome of outcomes) {
        if (outcome.artifacts.length > 0) {
          state = await this.commit(
            state,
            createUsageRecordedEvent(state, usageFromArtifacts(outcome.artifacts)),
          );
        }
        if ("error" in outcome) {
          state = await this.commit(
            state,
            createBranchFailedEvent(state, outcome.branchId, outcome.error.message),
          );
          continue;
        }
        if (outcome.resolution.type === "conclude") {
          state = await this.commit(
            state,
            createBranchConcludedEvent(
              state,
              outcome.branchId,
              outcome.resolution.conclusion,
            ),
          );
          continue;
        }
        try {
          state = await this.commit(
            state,
            createBranchExpandedEvent(state, outcome.branchId, outcome.resolution),
          );
        } catch (error) {
          if (
            error instanceof ExpansionValidationError &&
            error.violations.some((violation) => violation.includes("maxNodes"))
          ) {
            state = await this.commit(
              state,
              createBranchClosedEvent(state, outcome.branchId, "safety_limit"),
            );
          } else {
            state = await this.commit(
              state,
              createBranchFailedEvent(state, outcome.branchId, asError(error).message),
            );
          }
        }
      }
    }

    assertGraphInvariants(state);
    const dossier = assembleDossier(state);
    await this.store.writeSnapshot(runId, state);
    await this.store.writeDossier(runId, dossier);
    return dossier;
  }

  async createAndRun(
    request: DecisionRequest,
    config: BootstrapConfiguration,
    runId?: string,
  ): Promise<DecisionDossier> {
    const createdRunId = await this.create(request, config, runId);
    return this.run(createdRunId);
  }

  async approve(runId: string, approvalInput: Approval): Promise<DecisionDossier> {
    let state = await this.replay(runId);
    const approval = ApprovalSchema.parse(approvalInput);
    state = await this.commit(state, createApprovalRecordedEvent(state, approval));
    const dossier = assembleDossier(state);
    await this.store.writeSnapshot(runId, state);
    await this.store.writeDossier(runId, dossier);
    return dossier;
  }

  private async evaluateTerminalBranches(
    stateInput: DecisionState,
    completionInput: RunCompletion,
  ): Promise<DecisionState> {
    let state = stateInput;
    const branches = Object.values(state.branches)
      .filter((branch) => branch.status === "terminal" && branch.evaluations.length === 0)
      .sort((left, right) => left.createdOrdinal - right.createdOrdinal);

    const outcomes = await mapConcurrentStable(
      branches,
      state.config.concurrency,
      async (branch): Promise<EvaluationOutcome> => {
        try {
          const result = await runBranchEvaluationPanel({
            provider: this.provider,
            runId: state.runId,
            request: state.request,
            config: state.config,
            branch,
            onArtifact: (artifact) => this.store.writeCallArtifact(state.runId, artifact),
          });
          return {
            branchId: branch.id,
            evaluations: result.evaluations,
            artifacts: result.artifacts,
          };
        } catch (error) {
          return {
            branchId: branch.id,
            error: asError(error),
            artifacts: artifactsFromError(error),
          };
        }
      },
    );

    const evaluationFailures: string[] = [];
    for (const outcome of outcomes) {
      if (outcome.artifacts.length > 0) {
        state = await this.commit(
          state,
          createUsageRecordedEvent(state, usageFromArtifacts(outcome.artifacts)),
        );
      }
      if ("error" in outcome) {
        evaluationFailures.push(`${outcome.branchId}: ${outcome.error.message}`);
        continue;
      }
      for (const [ordinal, evaluation] of outcome.evaluations.entries()) {
        state = await this.commit(
          state,
          createBranchEvaluatedEvent(state, outcome.branchId, ordinal, evaluation),
        );
      }
    }

    const completion = evaluationFailures.length === 0
      ? completionInput
      : {
          classification: "partial_failure" as const,
          reasons: [...completionInput.reasons, ...evaluationFailures],
        };
    return this.commit(state, createRunCompletedEvent(state, completion));
  }

  private async commit(
    state: DecisionState,
    event: DecisionEvent,
  ): Promise<DecisionState> {
    await this.store.appendEvents(state.runId, [event]);
    const next = applyEvent(state, event);
    assertGraphInvariants(next);
    await this.store.writeSnapshot(state.runId, next);
    return next;
  }
}

export function branchContext(branch: BranchNode): unknown {
  return {
    branchId: branch.id,
    depth: branch.depth,
    orderedPath: branch.path,
    conclusion: branch.conclusion,
  };
}
