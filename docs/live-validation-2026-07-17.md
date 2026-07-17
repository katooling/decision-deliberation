# First Live Validation Run — 2026-07-17

## Scope

This is a connectivity, accounting, and comparison-harness validation on the packaged [`run-storage` case](../examples/validation/run-storage/request.json). It is not a quality benchmark and does not support a superiority claim.

Environment:

- Decision Deliberation development version `0.1.1`;
- Codex CLI `0.144.4` using existing local authentication;
- isolated, ephemeral, read-only `codex exec` calls;
- one-shot and sequential baseline outputs normalized to `BaselineDecisionSchema v1`; and
- decision-tree smoke configuration stopped at depth `1`.

## Runs

| Arm | Status | Calls | Input tokens | Output tokens | Total tokens | Token ratio | Latency |
|---|---|---:|---:|---:|---:|---:|---:|
| One-shot | complete | 1 | 20,770 | 1,173 | 21,943 | 0.204 | 41.2 s |
| Sequential grill | complete | 5 | 106,731 | 8,890 | 115,621 | 1.074 | 287.5 s |
| Decision tree | partial: maximum depth | 5 | 103,159 | 4,544 | 107,703 | 1.000 | 145.6 s |

The declared compute tolerance was `±15%`. The sequential baseline is compute-matched to the tree; the one-shot baseline is not. Codex CLI reported tokens and latency but no monetary cost, so cost remains unknown rather than zero.

## Tree result

The depth-bounded tree generated one question with two code-materialized branches and evaluated both leaves:

1. portable files as the canonical replay authority — adjusted score `0.887`; and
2. an embedded database as the canonical replay authority — adjusted score `0.827`.

The recommended branch keeps portable append-only files authoritative and treats database indexes as rebuildable projections, subject to explicit durability, corruption-detection, artifact-completeness, and projection-version contracts.

The run correctly reported `partial_budget_exhausted` with reason `max_depth`; it did not claim coverage. Both leaves were scored, no frontier remained, and the dossier retained uncertainty about the unresolved deeper mechanics.

## Defect discovered

The first tree attempt failed before inference because Zod's JSON Schema represented the expand/conclude union with `oneOf`, which Codex structured outputs rejects. The provider now:

1. emits a compatible schema with a discriminator and nullable peer fields;
2. translates only an exact envelope whose unused peer is `null`;
3. leaves contradictory or extended payloads untouched for controller-owned validation; and
4. retains the raw provider text in the call artifact while validating the canonical form with the unchanged Zod domain schema.

Regression tests also ensure that failed Codex runs retain redacted decisive tails of stdout and stderr instead of hiding an API error behind repeated warnings. The subprocess receives an explicit runtime/authentication environment allowlist rather than the full ambient environment.

After that security hardening, a fresh one-shot provider call succeeded using existing local authentication: `20,768` input tokens, `1,190` output tokens, and `45.1 s` latency. This is a connectivity/conformance proof, not an additional scored benchmark observation.

## What is not proven

- No blinded reviewer has scored the three artifacts.
- The decision tree stopped after one question and is not coverage-complete.
- Only one of the three packaged cases has live observations.
- The one-shot arm is not compute-matched.
- No dollar-cost comparison is available.

Therefore the current paired report has zero wins, zero losses, zero ties, and two unscored comparisons. Quality evaluation remains pending under the [`reviewer rubric`](reviewer-rubric.md); human onboarding evidence remains pending under the [`five-participant protocol`](user-study.md).
