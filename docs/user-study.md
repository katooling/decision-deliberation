# Five-Participant Validation Protocol

## Purpose

Measure whether a new target user can reach a useful decision dossier, understand it, and identify its limits without maintainer coaching. This is product discovery, not a demonstration script.

Do not fill the results from maintainer expectations. Record only observed sessions.

## Participants

Recruit five people who have recently made a path-dependent technical or product decision:

- technical leads;
- software architects;
- product engineers;
- researchers; or
- maintainers of complex tools.

At least three participants should not have seen Decision Deliberation before.

## Session setup

1. Give the participant the public README and a clean supported environment.
2. Ask them to install the released package or clone the repository.
3. Start the timer when they begin reading the quick start.
4. Do not intervene unless they are blocked for five minutes or encounter a product defect.
5. Ask them to run one packaged validation case and open the viewer.
6. Stop the activation timer when they can point to a recommendation in the viewer.

Record setup failures as one of: runtime, installation, provider, authentication, schema, execution, viewer, documentation, or unknown.

## Comprehension tasks

Without opening raw JSON, ask the participant to identify:

1. the recommended complete path;
2. the strongest alternative;
3. the most important assumption;
4. any failed, unscored, or incomplete branch; and
5. whether the run was coverage-complete or stopped by a budget or safety boundary.

Score each task `1` only when the participant identifies it correctly without coaching.

## Interview questions

Ask these after the tasks:

1. Tell me about a recent decision where an early plausible answer hid important downstream choices.
2. Which part of this dossier would change how you make that decision?
3. Which information did you expect but could not find?
4. Did you trust the recommendation, the trace, both, or neither? Why?
5. What would prevent you from using this on a real decision next week?

Avoid asking whether the product is “good.” Ask for concrete behavior and recent examples.

## Success thresholds

- Median activation time is under ten minutes.
- At least four of five participants reach the viewer without maintainer help.
- At least four of five identify the recommendation, strongest alternative, and main assumption.
- No more than one participant mistakes a partial run for complete coverage.
- Recurring blockers are converted into public issues and ranked by frequency and severity.

## Recording

Use [`user-study-results.template.csv`](../examples/validation/user-study-results.template.csv). Do not record names, employer information, proprietary decision content, credentials, or unredacted model transcripts.

## Paired review

The product-onboarding study and the decision-quality review are separate:

- onboarding participants exercise the product;
- blinded reviewers score normalized decision artifacts using [`reviewer-rubric.md`](reviewer-rubric.md); and
- [`benchmark-compare`](benchmark.md#paired-live-benchmark) joins reviews to hidden arm mappings and reports quality independently from compute.

Keeping those roles separate reduces demand characteristics and prevents setup friction from being mistaken for decision quality.
