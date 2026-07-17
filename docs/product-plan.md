# Product Plan

## Product definition

**Target user:** a technical lead, architect, researcher, or product engineer making a complex, path-dependent decision that deserves more than a single recommendation.

**Job to be done:** explore the most important admitted possibilities, preserve how every conclusion was reached, compare downstream outcomes with hindsight, and hand a decision maker an inspectable recommendation.

**Core promise:** better decision coverage and traceability within an explicit budget—not automatic truth and not automatic execution.

## Product principles

1. **Time to first useful result:** a new user should run the scripted demo and open the viewer in under ten minutes.
2. **Deterministic shell, judgmental core:** code controls orchestration; agents contribute bounded structured judgment.
3. **Progressive disclosure:** the first screen shows the decision, status, tree, and winner; detailed evidence remains one selection away.
4. **Honest stopping:** coverage, budget exhaustion, safety stops, and failures remain visibly different.
5. **Inspectability before autonomy:** every recommendation keeps its path, assumptions, evidence, scores, and unresolved uncertainty.
6. **Safe local defaults:** files remain local, the viewer is read-only and loopback-only, and recommendations await approval.
7. **Measure outcome and cost together:** quality claims include coverage, regret, calls, tokens, latency, failures, and constraints.

## Steps for a good product

### 1. Validate the problem

- Interview at least five target users about recent complex decisions.
- Collect sanitized examples of failures caused by early commitment or hidden path dependencies.
- Confirm that users value the dossier and traceability, not only the final recommendation.

### 2. Make onboarding measurable

- Measure time from clone or install to first complete demo.
- Track setup failures by stage: runtime, provider, schema, execution, or viewer.
- Maintain one default path and move advanced configuration behind links.

### 3. Prove the decision workflow

- Run blinded paired comparisons against one-shot and sequential baselines.
- Include compute-matched comparisons so extra inference is not mistaken for architecture benefit.
- Test both known-outcome fixtures and expert-judged real decisions.
- Publish losses, partial runs, cost, and constraint regressions alongside wins.

### 4. Harden the product contract

- Stabilize request, configuration, event, graph, and dossier schemas.
- Add explicit schema migrations before declaring `1.0.0`.
- Add provider conformance tests and reference adapters.
- Define compatibility and deprecation windows.

### 5. Improve daily usability

- Add a guided project initializer.
- Add cross-run comparison for BFS/DFS and breadth/depth configurations.
- Add resume and live-progress views without weakening replay determinism.
- Add export formats for common research and knowledge tools.
- Add accessibility and large-tree performance benchmarks.

### 6. Operate and learn

- Use issues for defects and Discussions for discovery.
- Review activation, completion, partial-run causes, and repeat usage monthly.
- Prioritize recurring user obstacles over speculative feature breadth.
- Keep product, security, documentation, and benchmark claims synchronized at release time.

## Success measures

### Activation

- median time to first complete demo under 10 minutes;
- at least 80% of clean-environment trials reach the viewer without maintainer help; and
- fewer than 10% of trials fail because of unclear setup instructions.

### Decision usefulness

- users can identify the recommendation, strongest alternative, main assumption, and incomplete branch without reading raw JSON;
- blinded reviewers prefer the treatment dossier over the strongest baseline on traceability and coverage; and
- treatment gains remain after compute matching on at least one representative scenario set.

### Reliability and trust

- deterministic replay produces byte-equivalent logical state;
- no run claims coverage while eligible, failed, or safety-stopped branches remain;
- release audits report no confirmed credentials or machine-specific paths; and
- high-severity runtime dependency advisories block release.

## Roadmap

### `0.1.x` — Public preview and learning

- GitHub release distribution and clean installation proof
- provider integration guide and one real reference adapter
- five user interviews and three sanitized decision cases
- accessibility and large-tree viewer checks
- first live paired benchmark report

Current `0.1.1` candidate status:

- reference Codex CLI provider and conformance coverage implemented;
- three sanitized cases and bounded configurations implemented;
- first one-shot, sequential-grill, and depth-bounded tree observations recorded for one case;
- compute matching and blinded-score joins implemented; and
- five-person onboarding and blinded-review collection remain pending real participants; and
- a frozen study manifest, replicate-aware analysis, and confidence intervals remain required before any inferential quality claim.

### `0.2.x` — Repeatable use

- guided initializer and configuration presets
- resume/progress support
- side-by-side run comparison
- provider conformance suite
- versioned export contract

### `0.3.x` — Team evaluation

- shared, access-controlled run storage behind an optional adapter
- richer audit and redaction controls
- multi-reviewer evaluation workflows
- performance budgets for large graphs

### `1.0.0` — Stable product contract

- documented stable public schemas and CLI
- migrations and deprecation policy
- representative real-world benchmark evidence
- proven onboarding, support, security, and release operations

Automatic execution, universal superiority claims, and unbounded autonomous exploration remain outside the product promise.
