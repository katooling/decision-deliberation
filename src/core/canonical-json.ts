import { createHash } from "node:crypto";

export type CanonicalJsonPrimitive = string | number | boolean | null;
export type CanonicalJsonValue =
  | CanonicalJsonPrimitive
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

function canonicalizeNumber(value: number): number {
  if (!Number.isFinite(value)) {
    throw new TypeError("Canonical JSON does not support non-finite numbers");
  }
  return Object.is(value, -0) ? 0 : value;
}

/**
 * Convert a JSON-compatible value to a value whose object keys are recursively
 * sorted. Arrays retain their order because order can carry domain meaning.
 * Callers must sort arrays that represent sets before invoking this function.
 */
export function canonicalize(value: unknown): CanonicalJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return canonicalizeNumber(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const result: Record<string, CanonicalJsonValue> = {};
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item === undefined) {
        throw new TypeError(`Canonical JSON does not support undefined at key ${key}`);
      }
      result[key] = canonicalize(item);
    }
    return result;
  }

  throw new TypeError(`Canonical JSON does not support values of type ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** Return a new, duplicate-free array sorted by canonical JSON representation. */
export function canonicalSet<T>(values: readonly T[]): T[] {
  const byCanonicalValue = new Map<string, T>();
  for (const value of values) {
    byCanonicalValue.set(canonicalJson(value), value);
  }
  return [...byCanonicalValue.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}
