import type { z } from "zod";

import type {
  AgentProvider,
  AgentRawResponse,
  AgentRequest,
} from "./provider.js";

export interface AgentCallArtifact<T = unknown> {
  artifactId: string;
  callId: string;
  attempt: number;
  request: AgentRequest;
  response?: AgentRawResponse;
  parsed?: T;
  valid: boolean;
  violations: string[];
}

export interface StructuredCallResult<T> {
  value: T;
  artifacts: AgentCallArtifact<T>[];
}

export interface StructuredCallOptions<T> {
  provider: AgentProvider;
  request:
    | AgentRequest
    | ((attempt: number, validationErrors: string[]) => AgentRequest);
  schema: z.ZodType<T>;
  maxAttempts: number;
  tagNames?: string[];
  semanticValidate?: (value: T) => string[];
  onArtifact?: (artifact: AgentCallArtifact<T>) => void | Promise<void>;
}

export class StructuredOutputError extends Error {
  readonly artifacts: AgentCallArtifact[];
  readonly violations: string[];

  constructor(message: string, artifacts: AgentCallArtifact[], violations: string[]) {
    super(message);
    this.name = "StructuredOutputError";
    this.artifacts = artifacts;
    this.violations = violations;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tryParseJson(candidate: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(candidate) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Parse either a raw JSON document or JSON enclosed by an XML-style result tag. */
export function parseStructuredJson(text: string, tagNames: string[] = ["result"]): unknown {
  const trimmed = text.trim();
  const direct = tryParseJson(trimmed);
  if (direct.ok) return direct.value;

  for (const tagName of tagNames) {
    const escaped = escapeRegExp(tagName);
    const matches = [...trimmed.matchAll(
      new RegExp(`<${escaped}\\s*>\\s*([\\s\\S]*?)\\s*</${escaped}\\s*>`, "gi"),
    )];
    const match = matches.at(-1);
    if (match?.[1] !== undefined) {
      const parsed = tryParseJson(match[1].trim());
      if (parsed.ok) return parsed.value;
    }
  }

  // Accept conventional role-specific tags such as <question_result> while
  // still requiring an explicit boundary around the JSON payload.
  const tagged = [...trimmed.matchAll(
    /<([a-z][a-z0-9_.-]*result[a-z0-9_.-]*)\s*>\s*([\s\S]*?)\s*<\/\1\s*>/gi,
  )].at(-1);
  if (tagged?.[2] !== undefined) {
    const parsed = tryParseJson(tagged[2].trim());
    if (parsed.ok) return parsed.value;
  }

  const fenced = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)].at(-1);
  if (fenced?.[1] !== undefined) {
    const parsed = tryParseJson(fenced[1].trim());
    if (parsed.ok) return parsed.value;
  }

  throw new Error("response did not contain valid raw or tagged JSON");
}

export function formatValidationIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length === 0 ? "$" : `$.${issue.path.join(".")}`;
    return `${path}: ${issue.message}`;
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function buildRequest(
  source: StructuredCallOptions<unknown>["request"],
  attempt: number,
  validationErrors: string[],
): AgentRequest {
  if (typeof source === "function") return source(attempt, validationErrors);
  return { ...source, attempt, validationErrors: [...validationErrors] };
}

/**
 * Invoke an agent with a strict structured-output contract. Invalid provider,
 * parse, schema, and semantic results are recorded and fed into the next
 * attempt. Model output is never repaired silently.
 */
export async function structuredCall<T>(
  options: StructuredCallOptions<T>,
): Promise<StructuredCallResult<T>> {
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer");
  }

  const artifacts: AgentCallArtifact<T>[] = [];
  let feedback: string[] = [];

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const request = buildRequest(options.request, attempt, feedback);
    const artifactBase = {
      artifactId: `${request.callId}.attempt-${attempt}`,
      callId: request.callId,
      attempt,
      request,
    };

    let response: AgentRawResponse | undefined;
    let parsed: unknown;
    let violations: string[] = [];

    try {
      response = await options.provider.invoke(request);
      parsed = parseStructuredJson(response.text, options.tagNames);
      const validation = options.schema.safeParse(parsed);
      if (!validation.success) {
        violations = formatValidationIssues(validation.error);
      } else {
        const semanticViolations = options.semanticValidate?.(validation.data) ?? [];
        violations = unique(semanticViolations);
        if (violations.length === 0) {
          const artifact: AgentCallArtifact<T> = {
            ...artifactBase,
            response,
            parsed: validation.data,
            valid: true,
            violations: [],
          };
          artifacts.push(artifact);
          await options.onArtifact?.(artifact);
          return { value: validation.data, artifacts };
        }
        parsed = validation.data;
      }
    } catch (error) {
      violations = [
        error instanceof Error ? error.message : `agent call failed: ${String(error)}`,
      ];
    }

    const artifact: AgentCallArtifact<T> = {
      ...artifactBase,
      ...(response === undefined ? {} : { response }),
      ...(parsed === undefined ? {} : { parsed: parsed as T }),
      valid: false,
      violations,
    };
    artifacts.push(artifact);
    await options.onArtifact?.(artifact);
    feedback = unique([...feedback, ...violations]);
  }

  throw new StructuredOutputError(
    `structured output remained invalid after ${options.maxAttempts} attempt(s)`,
    artifacts,
    feedback,
  );
}
