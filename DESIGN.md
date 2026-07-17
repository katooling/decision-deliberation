# Decision Deliberation System

## Goal

Build a local-first system that explores every admitted answer path within an explicit scope, evaluates complete paths with hindsight, and produces a traversable Decision Dossier for Human Approval. It never executes the decision.

## Core decisions

- A Bootstrap Configuration selects coverage or budget mode and controls question-panel size, option bounds, traversal, depth, calls, concurrency, and evaluation criteria.
- One logical question expands one Decision Branch.
- Every accepted question contains atomic, mutually exclusive Candidate Answers.
- The controller creates one child branch per admitted option. There is no answer agent.
- Ordered path history is canonical. Identical question text does not make two branches equivalent, and the MVP performs no semantic branch merging.
- Coverage succeeds only when the Decision Frontier is empty with no failed or safety-stopped branch.
- Budget, safety, and exhausted-retry stops produce a Partial Dossier.
- BFS and DFS are supported. Coverage mode reaches the same finite paths; budget mode may expose different partial evidence.
- Several Bootstrap Configurations run as separate experiments and can be benchmarked later.

## Execution architecture

The product-facing flow wraps the controller without weakening it:

```text
plain-language decision
    → bounded Decision Interview
    → validated Decision Framing
    → deterministic Decision Deliberation
    → recommendation-first decision page
        ├─ portable ADR export
        └─ read-only reasoning-tree viewer
```

The interview and framing steps use the same structured provider seam as deliberation roles. Code owns the single-current-question invariant, maximum question count, validated criteria, transition into a persisted run, and Human Approval boundary. The normal product flow exposes none of the traversal or agent-panel configuration.

The local HTTP module owns loopback-by-default listening, bounded JSON request bodies, security headers, and static-file confinement. The product and viewer supply separate request-handler adapters. Product writes and same-origin validation therefore remain absent from the read-only viewer module even when both surfaces share one application port.

The default topology is a deterministic hub-and-spoke coordinator:

```text
branch context
    ├─ independent proposer 1 ─┐
    ├─ independent proposer 2 ─┼─ coverage reviewer ─ synthesizer
    └─ independent proposer 3 ─┘                         │
                                                        ├─ conclude branch
                                                        └─ code materializes every option
```

The coordinator owns work IDs, scheduling, stable commit order, schemas, semantic invariants, retries, traversal, persistence, termination, and Hindsight Reduction. Agents own question discovery, option discovery, coverage criticism, synthesis, evidence, and branch evaluation. Direct agent-to-agent conversation is deferred; all MVP communication passes through the coordinator and is recorded.

Sandcastle is an optional agent-execution adapter, not the domain controller. The same runner contract supports deterministic fixtures and local commands, keeping tests independent of Docker, credentials, and live models.

## Question contract

Question agents return schema-versioned structured output. A synthesized resolution is either:

- `expand`: one question, rationale, option set, local recommendation, and explicit coverage/atomicity/exclusivity rationales; or
- `conclude`: a Branch Conclusion with conditions, caveats, and unresolved questions.

The Bootstrap Configuration provides minimum, target, and maximum option counts. The target is guidance; the maximum is enforced. The synthesizer may return fewer than the target rather than invent filler.

The controller assigns all IDs. It rejects malformed output, duplicate option keys, option-count violations, and recommendations that reference nonexistent options. It sends exact violations on retry, permits at most two total attempts, and never silently repairs model output.

## Canonical data model

The source model is a path-sensitive tree of branch states and question expansions:

- A branch records its ordered selected-option history, depth, status, and conclusion/evaluation references.
- A question expansion belongs to one branch and preserves the final synthesized question plus its local recommendation.
- An edge/child branch records the selected Candidate Answer. It is deterministic data, not agent judgment.
- A conclusion closes a branch.

IDs and path hashes derive from canonical structured content. They provide replay idempotency only; they do not justify semantic merging.

## Traversal and termination

- BFS selects minimum-depth frontier branches in stable order.
- DFS selects deepest frontier branches in stable order.
- Concurrent work receives IDs before execution and commits in work order rather than completion order.
- Coverage mode expands every admitted option until every branch concludes.
- Budget mode stops at its first configured limit and keeps unresolved frontier branches visible.
- A safety limit in coverage mode prevents runaway work but cannot yield a complete dossier.

## Evaluation and hindsight

Each Branch Conclusion is evaluated against the same weighted Decision Criteria. Configurable independent evaluations are aggregated by criterion median. Code calculates weighted utility and performs deterministic post-order reduction.

At every earlier question, the output preserves:

- each option's best reachable conclusion;
- best, mean, and worst descendant utility;
- conclusion count;
- local question-time recommendation; and
- whether hindsight changed that recommendation.

The root's strongest reachable conclusion becomes the recommendation. Other concluded paths remain ranked and queryable. Confidence describes evaluation certainty and never substitutes for utility.

## Persistence and access

Each run uses append-only JSONL events as its source of truth and derives:

- `graph.json` for traversal and tooling;
- `dossier.json` for queries and benchmarks;
- `dossier.md` for people;
- per-call artifacts containing inputs, raw outputs, validation results, usage, and provider metadata; and
- an approval event recording approve or reject without executing anything.

Replay from saved events is provider-free and must reproduce the same logical graph and dossier. Runtime timestamps and provider latency are provenance, not deterministic graph content.

## Public-preview surface

- local product application with decision intake, bounded clarification, framing, and a recommendation-first page
- ADR-style portable decision export and direct reasoning-tree navigation
- TypeScript library and CLI
- BFS/DFS, coverage/budget policies, safety limits, and bounded concurrency
- proposer/reviewer/synthesizer question panels
- deterministic Branch Expansion
- scripted and command agent runners
- structured validation and two-attempt recovery
- append-only persistence, replay, status, inspection, exports, and approval
- rubric-based branch evaluation and post-order Hindsight Reduction
- deterministic algorithm benchmarks plus an optional live paired benchmark protocol
- deterministic tree and radial viewer projections
- read-only loopback viewer server with search, focus, collapse, breadcrumbs, minimap, deep links, and evidence inspection

## Deferred

PostgreSQL, SQLite, a hosted REST service, distributed queues, semantic branch merging, embeddings, beam/hybrid search, unbounded direct debate, automatic execution, and universal superiority claims are outside the public preview.
