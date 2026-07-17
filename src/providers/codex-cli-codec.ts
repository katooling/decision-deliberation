import { z } from "zod";

import type { AgentRequest, AgentRole } from "../agents/provider.js";
import {
  BaselineDecisionSchema,
  BranchEvaluationSchema,
  ConclusionResolutionSchema,
  CoverageReviewSchema,
  ExpansionResolutionSchema,
  FinalSynthesisSchema,
  QuestionProposalSchema,
} from "../domain/schemas.js";

type JsonSchemaObject = Record<string, unknown>;

export function schemaForRequest(request: AgentRequest): z.ZodType {
  switch (request.role) {
    case "question-proposer":
      return QuestionProposalSchema;
    case "coverage-reviewer":
      return CoverageReviewSchema;
    case "question-synthesizer":
      return FinalSynthesisSchema;
    case "branch-evaluator":
      return BranchEvaluationSchema;
    case "baseline-designer":
      return BaselineDecisionSchema;
  }
}

function usesCompatibleResolutionSchema(role: AgentRole): boolean {
  return role === "question-proposer" || role === "question-synthesizer";
}

function objectProperties(schema: JsonSchemaObject): Record<string, JsonSchemaObject> {
  if (typeof schema.properties !== "object" || schema.properties === null) {
    throw new Error("generated JSON Schema did not contain object properties");
  }
  return schema.properties as Record<string, JsonSchemaObject>;
}

function nullableObjectSchema(schema: JsonSchemaObject): JsonSchemaObject {
  return { ...structuredClone(schema), type: ["object", "null"] };
}

/** Codex structured outputs rejects `oneOf`, so encode the union with nullable peers. */
export function outputSchemaForRequest(request: AgentRequest, schema: z.ZodType): JsonSchemaObject {
  const generated = z.toJSONSchema(schema) as JsonSchemaObject;
  if (!usesCompatibleResolutionSchema(request.role)) return generated;

  const expansion = z.toJSONSchema(ExpansionResolutionSchema) as JsonSchemaObject;
  const conclusion = z.toJSONSchema(ConclusionResolutionSchema) as JsonSchemaObject;
  const expansionProperties = objectProperties(expansion);
  const conclusionProperties = objectProperties(conclusion);
  const rootProperties = objectProperties(generated);
  return {
    ...generated,
    properties: {
      ...rootProperties,
      resolution: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["expand", "conclude"] },
          question: nullableObjectSchema(expansionProperties.question ?? {}),
          conclusion: nullableObjectSchema(conclusionProperties.conclusion ?? {}),
        },
        required: ["type", "question", "conclusion"],
        additionalProperties: false,
      },
    },
  };
}

function hasExactlyKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

/**
 * Translate only an exact Codex compatibility envelope. Contradictory or
 * extended payloads remain untouched so controller-owned validation records
 * the raw failure instead of accepting a repaired document.
 */
export function decodeCodexStructuredText(request: AgentRequest, rawText: string): string {
  if (!usesCompatibleResolutionSchema(request.role)) return rawText;

  let value: unknown;
  try {
    value = JSON.parse(rawText) as unknown;
  } catch {
    return rawText;
  }
  if (typeof value !== "object" || value === null) return rawText;
  const document = value as Record<string, unknown>;
  if (!hasExactlyKeys(document, ["schemaVersion", "resolution"])) return rawText;
  if (typeof document.resolution !== "object" || document.resolution === null) return rawText;
  const resolution = document.resolution as Record<string, unknown>;
  if (!hasExactlyKeys(resolution, ["type", "question", "conclusion"])) return rawText;

  if (resolution.type === "expand" && resolution.question !== null && resolution.conclusion === null) {
    return JSON.stringify({
      schemaVersion: document.schemaVersion,
      resolution: { type: "expand", question: resolution.question },
    });
  }
  if (resolution.type === "conclude" && resolution.conclusion !== null && resolution.question === null) {
    return JSON.stringify({
      schemaVersion: document.schemaVersion,
      resolution: { type: "conclude", conclusion: resolution.conclusion },
    });
  }
  return rawText;
}
