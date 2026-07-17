# Benchmark Contract

## Claims

The bundled benchmark may establish algorithmic properties and improvement on declared closed-world fixtures. It cannot establish broad real-world superiority. Synthetic and live evidence must always be reported separately.

## Compared systems

- **B0 — one-shot baseline:** one strong design prompt requesting alternatives, constraints, evidence, assumptions, uncertainty, and a recommendation.
- **B1 — sequential baseline:** one logical agent receives a compute-matched plan, critique, and revision loop without branching.
- **T1 — traversal treatment:** one proposer per branch, deterministic exhaustive expansion, leaf evaluation, and Hindsight Reduction.
- **T2 — default treatment:** three independent proposers, one coverage reviewer, one synthesizer, deterministic exhaustive expansion, leaf evaluation, and Hindsight Reduction.

The deterministic MVP command runs closed-world B0/T1-style algorithm fixtures. B1/T2 live comparisons require a configured real provider because inference quality cannot be honestly simulated.

## Closed-world fixtures

Fixture trees contain path-dependent choices, hard constraints, local-optimum traps, and known leaf utility. The treatment explores admitted branches; the baseline follows the locally recommended path without hindsight. The scorer remains private from the simulated decision policy.

Required metrics:

- exact-optimal rate;
- normalized regret;
- admitted-path coverage;
- hard-constraint violation rate;
- call and node counts; and
- treatment improvement over baseline.

The command fails if orchestration loses an admitted path, recommends a non-descendant, produces nondeterministic replay, or does not beat the preregistered synthetic baseline threshold.

## Live paired protocol

For real-model evidence that supports an inferential quality claim:

1. freeze and hash cases, prompts, schemas, configurations, model identifiers, reducer, and scorer;
2. give every arm identical public facts, criteria, tool policy, and dossier output contract;
3. keep private outcome keys and scoring code outside agent-readable storage;
4. compare both natural operating cost and a compute-matched budget;
5. randomize run order and blind dossier labels before qualitative judging;
6. retain failures, timeouts, retries, raw outputs, token use, cost, and latency;
7. average replicates within a case before paired analysis; and
8. report confidence intervals, per-case results, quality/cost, and hard-constraint regressions.

A quality gain against B0 but not compute-matched B1 supports “more inference helped,” not an architecture advantage.

The current `decision-deliberation-paired-v1` analyzer is deliberately narrower than this full protocol. It validates one observed artifact per arm and case, enforces paired blinded reviewer sets, reports descriptive per-case quality and cost, and preserves incomplete evidence. It does not yet accept replicate sets, a frozen-study manifest, or calculate confidence intervals. Until those capabilities exist, its output is pilot evidence only and must not support an architecture-superiority claim.

### Paired live benchmark

Generate baseline decisions through the same configured provider:

```bash
deliberate benchmark-baseline case/request.json \
  --provider provider.json \
  --arm one_shot \
  --rounds 1 \
  --out work/one-shot.json

deliberate benchmark-baseline case/request.json \
  --provider provider.json \
  --arm sequential_grill \
  --rounds 5 \
  --out work/sequential.json
```

Baseline JSON includes every structured call artifact, including invalid retry attempts and raw provider responses. Failed baseline commands still write the failure bundle when `--out` is supplied before exiting nonzero. Keep these files in an ignored private evidence directory because provider transcripts may contain supplied decision context.

Normalize baseline decisions and Decision Dossiers through the exported `normalizeBaselineArtifact` and `normalizeDossierArtifact` functions before review. Both produce the same artifact keys and omit run IDs, branch IDs, arm labels, scores, calls, tokens, and latency.

Reviewers score only randomized `artifactId` files using the [blinded rubric](reviewer-rubric.md). After scores are frozen, join them to the hidden arm mapping in an observation suite and run:

```bash
deliberate benchmark-compare observations.json --out report.md
```

The analyzer reports reviewer quality separately from compute. It classifies every observed baseline as matched or unmatched using the suite's declared token tolerance and preserves partial runs, failed runs, explicitly missing observations, missing reviews, constraints, losses, and ties. Missing observations use `status: "missing"` with zero calls and usage; incomplete, failed, missing, or constraint-violating comparisons remain unscored.

Every `complete` observation must contain at least one call plus observed token use and latency. Every participating reviewer must score every non-missing artifact in a case and persist one concrete strength and weakness. This prevents absent inference and mismatched reviewer populations from becoming wins or losses.

Use [`paired-observations.template.json`](../examples/validation/paired-observations.template.json) as the data contract. Zero calls and empty reviews mean evidence is pending; they are not placeholder wins.

## Claim gate

Any report must say exactly which suite passed. The fixed disclaimer is:

> These results measure declared decision fixtures and do not establish broad real-world superiority.
