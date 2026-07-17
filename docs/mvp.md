# MVP Contract

## Behavior that must pass

Given a decision request, Bootstrap Configuration, and saved agent outputs, the system must:

1. validate every agent result against a versioned contract;
2. create exactly one child branch for every admitted Candidate Answer without invoking an answer agent;
3. select frontier work deterministically under BFS or DFS;
4. preserve complete ordered path history;
5. distinguish Bounded Coverage from all partial stopping reasons;
6. evaluate concluded paths against one shared rubric;
7. propagate descendant outcomes from leaves to root;
8. produce queryable graph and dossier artifacts;
9. reproduce the same logical result from its event stream without calling an agent; and
10. record Human Approval without executing the recommendation.
11. project the saved state into deterministic tree and radial layouts without changing canonical branch identity.
12. expose complete, partial, failed, boundary, open, and unknown-score states in a read-only viewer.

## Narrow proof order

```text
schema and semantic validation
→ branch expansion and traversal
→ event replay
→ backwards reduction
→ end-to-end scripted deliberation
→ deterministic benchmark
→ optional live-provider benchmark
```

Broad or live runs do not replace a failing narrow proof.

## MVP acceptance

- TypeScript compilation succeeds.
- Unit and integration tests cover every behavior above.
- A scripted example generates the expected full tree and root recommendation.
- Reversing asynchronous completion order leaves the logical graph unchanged.
- Coverage mode never reports success while a frontier, failed branch, or safety-stopped branch remains.
- The bundled deterministic benchmark demonstrates lower regret than its greedy and one-shot fixture baselines and labels that evidence as synthetic.
- Documentation explains how to connect a real command-based agent and how to run a paired live benchmark without overstating its result.
- Viewer data, layout, static assets, and loopback server checks pass.

## Non-goals

The MVP does not provide a hosted service, database, collaborative editing, semantic merging, learned search policy, distributed workers, automatic execution, or a universal claim that agent trees outperform every normal design process.
