# Blinded Decision-Artifact Rubric

Reviewers receive normalized artifacts named only by `artifactId`. Do not provide the arm mapping, call count, token use, latency, or product name until scoring is complete.

Score each dimension from `0.0` to `1.0` in increments of `0.1`.

## Decision quality

- `0.0`: no actionable recommendation or reasoning;
- `0.5`: plausible recommendation with material unsupported leaps; and
- `1.0`: clear, feasible recommendation whose reasoning addresses the declared criteria and constraints.

## Coverage

- `0.0`: ignores major admitted alternatives or downstream consequences;
- `0.5`: covers obvious options but leaves important angles unexamined; and
- `1.0`: addresses the important admitted alternatives and clearly states what remains outside scope.

## Traceability

- `0.0`: conclusions cannot be connected to assumptions or evidence;
- `0.5`: some reasoning is visible but important links remain implicit; and
- `1.0`: recommendation, alternatives, assumptions, uncertainty, and evidence form an inspectable chain.

## Review procedure

1. Read the case request once.
2. Review artifacts in a randomized order.
3. Score every artifact before discussing any with another reviewer.
4. Record one concrete strength and one concrete weakness separately from the numeric scores.
5. Submit scores keyed only by `artifactId`.
6. Reveal the arm mapping only after every score is frozen.

Do not change a score after arm disclosure. Corrections for data-entry mistakes must retain the original value and an explanation.
