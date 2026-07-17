# Changelog

All notable changes are documented here. This project follows Semantic Versioning once its public API stabilizes.

## [Unreleased]

### Added

- isolated Codex CLI provider with role-specific structured output and token accounting;
- Codex-compatible expand/conclude schemas without changing the strict domain union;
- one-shot and sequential-grill baseline runner;
- paired benchmark analyzer with explicit compute-matching and blinded review joins;
- normalized review artifacts that hide arm-specific operational details;
- three sanitized validation cases, bounded smoke and validation configurations, and a real-provider example;
- five-participant onboarding protocol, blinded reviewer rubric, and evidence-capture templates; and
- first live compute report for the run-storage case.

### Fixed

- preserve the decisive tails of both stdout and stderr when `codex exec` fails;
- represent unavailable provider cost as unknown in the baseline runner instead of zero.

## [0.1.0] - 2026-07-17

### Added

- deterministic BFS and DFS decision-tree traversal;
- coverage and budget completion policies with explicit partial outcomes;
- independent proposer, reviewer, synthesizer, and evaluator contracts;
- code-controlled branch materialization with no answer agent;
- append-only events, replayable graph snapshots, and Decision Dossiers;
- deterministic hindsight reduction and synthetic comparison benchmark;
- scripted and command-based provider adapters;
- read-only interactive tree and radial viewer;
- search, breadcrumbs, minimap, focus, collapse, deep links, and evidence inspector;
- public release audit, production-only packaging, and CI checks.

[0.1.0]: https://github.com/katooling/decision-deliberation/releases/tag/v0.1.0
[Unreleased]: https://github.com/katooling/decision-deliberation/compare/v0.1.0...HEAD
