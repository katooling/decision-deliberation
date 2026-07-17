export type AgentRole =
  | "decision-interviewer"
  | "decision-framer"
  | "question-proposer"
  | "coverage-reviewer"
  | "question-synthesizer"
  | "branch-evaluator"
  | "baseline-designer";

export interface AgentRequest {
  callId: string;
  role: AgentRole;
  input: unknown;
  contract: string;
  attempt: number;
  validationErrors: string[];
}

export interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
}

export interface AgentRawResponse {
  text: string;
  usage?: AgentUsage;
  metadata?: Record<string, unknown>;
}

export interface AgentProvider {
  invoke(request: AgentRequest): Promise<AgentRawResponse>;
}
