import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { AgentProvider, AgentRequest } from "../agents/provider.js";
import { structuredCall, type AgentCallArtifact } from "../agents/structured-call.js";
import type { DecisionDossier } from "../core/dossier.js";
import {
  BootstrapConfigurationSchema,
  DecisionInterviewTurnSchema,
  DecisionRequestSchema,
  type BootstrapConfiguration,
  type DecisionRequest,
} from "../domain/schemas.js";
import { DecisionEngine } from "../orchestration/engine.js";
import { FileRunStore } from "../persistence/file-run-store.js";
import { renderDecisionAdr } from "./adr.js";

const SessionInputSchema = z.object({
  decision: z.string().trim().min(10).max(5_000),
  context: z.string().trim().max(20_000).default(""),
}).strict();

const AnswerInputSchema = z.object({
  answer: z.string().trim().min(1).max(10_000),
}).strict();

export const DEFAULT_PRODUCT_CONFIGURATION = BootstrapConfigurationSchema.parse({
  schemaVersion: 1,
  completion: "budget",
  traversal: "bfs",
  questionPipeline: { proposerCount: 2, reviewerCount: 1, synthesizerCount: 1 },
  options: { min: 2, target: 3, max: 4 },
  limits: {
    maxDepth: 2,
    maxNodes: 32,
    maxQuestions: 10,
    maxAgentCalls: 48,
    maxWallTimeMs: 600_000,
  },
  concurrency: 2,
  maxAttemptsPerCall: 2,
  evaluatorCount: 1,
  confidencePenalty: 0.08,
});

export interface ProductAnswer {
  question: string;
  rationale: string;
  answer: string;
}

export interface ProductQuestion {
  text: string;
  rationale: string;
}

interface ProductSessionBase {
  sessionId: string;
  decision: string;
  context: string;
  reflection: string;
  answers: ProductAnswer[];
}

export type ProductSessionView =
  | (ProductSessionBase & {
      status: "question";
      question: ProductQuestion;
      framing: null;
    })
  | (ProductSessionBase & {
      status: "ready";
      question: null;
      framing: DecisionRequest;
    });

export interface ProductDecisionResult extends ProductSessionBase {
  status: "complete";
  question: null;
  framing: DecisionRequest;
  runId: string;
  dossier: DecisionDossier;
  adr: string;
}

interface ProductSession extends ProductSessionBase {
  status: "starting" | "question" | "ready" | "running" | "complete";
  question: ProductQuestion | null;
  framing: DecisionRequest | null;
  runId: string | null;
  dossier: DecisionDossier | null;
  adr: string | null;
  artifacts: AgentCallArtifact[];
}

export class ProductWorkflowError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) {
    super(message);
    this.name = "ProductWorkflowError";
  }
}

export interface DecisionProductOptions {
  provider: AgentProvider;
  store: FileRunStore;
  config?: BootstrapConfiguration;
  maxQuestions?: number;
}

const INTERVIEW_CONTRACT =
  "Return DecisionInterviewTurnSchema v1 as raw JSON. Ask exactly one concise question only when its answer could materially change the recommendation, alternatives, criteria, constraints, or required evidence. Set ready=true when the supplied framing is sufficient. Never repeat an answered question.";

const FRAMING_CONTRACT =
  "Return DecisionRequestSchema v1 as raw JSON. Preserve the original decision and interview answers. Produce 2 to 6 explicit weighted criteria with concrete zero and one anchors. Keep automatic execution and unsupported domains out of scope.";

function request(
  session: ProductSession,
  role: "decision-interviewer" | "decision-framer",
  input: unknown,
  contract: string,
): AgentRequest {
  return {
    callId: `${session.sessionId}.${role}.${session.answers.length}`,
    role,
    input,
    contract,
    attempt: 1,
    validationErrors: [],
  };
}

function view(session: ProductSession): ProductSessionView {
  const common: ProductSessionBase = {
    sessionId: session.sessionId,
    decision: session.decision,
    context: session.context,
    reflection: session.reflection,
    answers: structuredClone(session.answers),
  };
  if (session.status === "question" && session.question !== null) {
    return { ...common, status: "question", question: { ...session.question }, framing: null };
  }
  if (session.status === "ready" && session.framing !== null) {
    return { ...common, status: "ready", question: null, framing: structuredClone(session.framing) };
  }
  throw new Error(`session ${session.sessionId} cannot be viewed in state ${session.status}`);
}

function validateFraming(framing: DecisionRequest): string[] {
  const violations: string[] = [];
  if (framing.criteria.length < 2 || framing.criteria.length > 6) {
    violations.push(`product framing requires 2 to 6 criteria; received ${framing.criteria.length}`);
  }
  const weight = framing.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (Math.abs(weight - 1) > 0.001) {
    violations.push(`product criterion weights must sum to 1; received ${weight}`);
  }
  return violations;
}

export class DecisionProduct {
  private readonly provider: AgentProvider;
  private readonly store: FileRunStore;
  private readonly config: BootstrapConfiguration;
  private readonly maxQuestions: number;
  private readonly sessions = new Map<string, ProductSession>();

  constructor(options: DecisionProductOptions) {
    this.provider = options.provider;
    this.store = options.store;
    this.config = BootstrapConfigurationSchema.parse(options.config ?? DEFAULT_PRODUCT_CONFIGURATION);
    this.maxQuestions = options.maxQuestions ?? 4;
    if (!Number.isInteger(this.maxQuestions) || this.maxQuestions < 1 || this.maxQuestions > 8) {
      throw new RangeError("maxQuestions must be an integer from 1 to 8");
    }
  }

  async begin(input: unknown): Promise<ProductSessionView> {
    const parsed = SessionInputSchema.safeParse(input);
    if (!parsed.success) throw new ProductWorkflowError(400, z.prettifyError(parsed.error));
    const session: ProductSession = {
      sessionId: `session_${randomUUID()}`,
      decision: parsed.data.decision,
      context: parsed.data.context,
      reflection: "",
      answers: [],
      status: "starting",
      question: null,
      framing: null,
      runId: null,
      dossier: null,
      adr: null,
      artifacts: [],
    };
    this.sessions.set(session.sessionId, session);
    try {
      await this.advance(session);
    } catch (error) {
      this.sessions.delete(session.sessionId);
      throw error;
    }
    return view(session);
  }

  async answer(sessionId: string, input: unknown): Promise<ProductSessionView> {
    const session = this.session(sessionId);
    if (session.status !== "question" || session.question === null) {
      throw new ProductWorkflowError(409, "This session is not waiting for an answer");
    }
    const parsed = AnswerInputSchema.safeParse(input);
    if (!parsed.success) throw new ProductWorkflowError(400, z.prettifyError(parsed.error));
    const pendingQuestion = { ...session.question };
    session.answers.push({
      question: session.question.text,
      rationale: session.question.rationale,
      answer: parsed.data.answer,
    });
    session.question = null;
    try {
      if (session.answers.length >= this.maxQuestions) await this.frame(session);
      else await this.advance(session);
    } catch (error) {
      session.answers.pop();
      session.question = pendingQuestion;
      session.status = "question";
      throw error;
    }
    return view(session);
  }

  async deliberate(sessionId: string): Promise<ProductDecisionResult> {
    const session = this.session(sessionId);
    if (session.status !== "ready" || session.framing === null) {
      throw new ProductWorkflowError(409, "This session is not ready for deliberation");
    }
    session.status = "running";
    const runId = `run_${session.sessionId}`;
    try {
      const engine = new DecisionEngine({ store: this.store, provider: this.provider });
      if (session.runId === null) {
        await engine.create(session.framing, this.config, runId);
        session.runId = runId;
        await Promise.all(session.artifacts.map((artifact) => this.store.writeCallArtifact(runId, artifact)));
      }
      const dossier = await engine.run(runId);
      const adr = renderDecisionAdr(dossier);
      await this.store.writeDecisionDocument(runId, adr);
      session.status = "complete";
      session.runId = runId;
      session.dossier = dossier;
      session.adr = adr;
      return {
        sessionId: session.sessionId,
        decision: session.decision,
        context: session.context,
        reflection: session.reflection,
        answers: structuredClone(session.answers),
        status: "complete",
        question: null,
        framing: structuredClone(session.framing),
        runId,
        dossier: structuredClone(dossier),
        adr,
      };
    } catch (error) {
      session.status = "ready";
      throw error;
    }
  }

  async exportAdr(runId: string): Promise<string> {
    if (!/^run_session_[a-f0-9-]+$/.test(runId)) {
      throw new ProductWorkflowError(400, "Invalid run ID");
    }
    const adr = await this.store.readDecisionDocument(runId);
    if (adr === undefined) {
      throw new ProductWorkflowError(404, "Decision document not found");
    }
    return adr;
  }

  private session(sessionId: string): ProductSession {
    if (!/^session_[a-f0-9-]+$/.test(sessionId)) {
      throw new ProductWorkflowError(400, "Invalid session ID");
    }
    const session = this.sessions.get(sessionId);
    if (session === undefined) throw new ProductWorkflowError(404, "Decision session not found");
    return session;
  }

  private async advance(session: ProductSession): Promise<void> {
    const result = await structuredCall({
      provider: this.provider,
      request: request(session, "decision-interviewer", {
        decision: session.decision,
        context: session.context,
        answers: session.answers,
        questionsRemaining: this.maxQuestions - session.answers.length,
      }, INTERVIEW_CONTRACT),
      schema: DecisionInterviewTurnSchema,
      maxAttempts: this.config.maxAttemptsPerCall,
    });
    session.artifacts.push(...result.artifacts);
    session.reflection = result.value.reflection;
    if (result.value.ready) {
      await this.frame(session);
      return;
    }
    if (result.value.question === null || result.value.rationale === null) {
      throw new Error("validated interview turn omitted its question");
    }
    session.status = "question";
    session.question = { text: result.value.question, rationale: result.value.rationale };
  }

  private async frame(session: ProductSession): Promise<void> {
    const result = await structuredCall({
      provider: this.provider,
      request: request(session, "decision-framer", {
        decision: session.decision,
        context: session.context,
        answers: session.answers,
      }, FRAMING_CONTRACT),
      schema: DecisionRequestSchema,
      maxAttempts: this.config.maxAttemptsPerCall,
      semanticValidate: validateFraming,
    });
    session.artifacts.push(...result.artifacts);
    session.framing = result.value;
    session.status = "ready";
    session.question = null;
  }
}
