# Contributing

Thanks for helping improve Decision Deliberation. The project is in public preview, so small changes with explicit proof are easier to review than broad rewrites.

## Before opening an issue

- Use GitHub Discussions for usage questions and design exploration.
- Use a bug report for reproducible incorrect behavior.
- Use a feature request for a concrete user problem, not only a proposed implementation.
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Development setup

Requirements: Node.js 24 or newer and npm.

```bash
git clone https://github.com/katooling/decision-deliberation.git
cd decision-deliberation
npm ci
npm run verify
```

Run the demo and viewer:

```bash
npm run cli -- run examples/demo/request.json \
  --config examples/demo/config.json \
  --provider examples/demo/provider.json \
  --out runs \
  --run-id demo
npm run view -- --runs runs
```

## Change workflow

1. Define the behavior that should change.
2. Add or update the narrowest test that proves it.
3. Keep deterministic controller behavior separate from agent judgment.
4. Run the focused test while iterating.
5. Run `npm run verify` before opening a pull request.
6. Run `npm run release:check` when changing packaging, the CLI, public schemas, or viewer assets.

Pull requests should explain the user impact, the contract being changed, and the proof used. Do not commit generated `runs/`, `work/`, `outputs/`, `dist/`, credentials, local paths, or raw provider transcripts containing private data.

## Architecture invariants

- Code owns IDs, schemas, branch creation, traversal, persistence, termination, and reduction.
- Agents propose and evaluate structured judgments; they do not mutate the graph directly.
- Ordered path history remains canonical.
- Missing scores are unknown, never zero.
- Partial runs never claim complete coverage.
- Recommendations wait for explicit human approval and are never executed automatically.

Read [CONTEXT.md](CONTEXT.md), [DESIGN.md](DESIGN.md), and the ADRs in [`docs/adr/`](docs/adr/) before changing these invariants.
