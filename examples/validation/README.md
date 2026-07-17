# Validation Examples

This directory contains three sanitized decision cases:

- `knowledge-migration` — preserve retrieval, provenance, and usability while moving to local Markdown;
- `release-distribution` — choose an early-stage open-source CLI distribution path; and
- `run-storage` — choose canonical local run storage without sacrificing replay or queries.

Use `config-smoke.json` to verify provider connectivity cheaply. It stops at depth one and therefore must report a partial result. Use `config.json` for a small multi-level study; inspect its declared limits before running because real providers can consume substantial time and tokens.

## Codex smoke run

```bash
deliberate run run-storage/request.json \
  --config config-smoke.json \
  --provider provider-codex.json \
  --out ../../runs \
  --run-id run-storage-smoke
```

The Codex provider reuses existing CLI authentication and does not store a key in this repository.

## Evidence collection

- `paired-observations.template.json` holds arm usage, status, constraint violations, and blinded reviewer evidence. Every review record must include `reviewerId`, `artifactId`, numeric `scores`, one concrete `strength`, and one concrete `weakness`; each participating reviewer must score every non-missing artifact in the case.
- `user-study-results.template.csv` records onboarding behavior for five real participants.
- Generated decisions, call artifacts, model transcripts, and participant notes belong in ignored private working directories, not this public example tree.
- `benchmark-baseline --out` writes successful or failed attempt artifacts into its JSON result; treat that file as a private transcript-bearing evidence bundle.
