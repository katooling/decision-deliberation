# Decision Deliberation

This context describes a system that explores a decision space through structured questions and candidate answers, then presents the resulting conclusions for human judgment.

## Language

**Decision Deliberation**:
A bounded investigation that explores the possibilities relevant to one decision and ends with a recommendation for human approval.
_Avoid_: Automatic decision, grilling session

**Decision Interview**:
A bounded, one-question-at-a-time clarification of the decision's desired outcome, constraints, alternatives, criteria, and evidence needs. A question is eligible only when its answer could materially change the later recommendation.
_Avoid_: Intake form, unbounded chat

**Decision Framing**:
The validated Decision Request produced from the original statement, supplied context, and Decision Interview answers before branch exploration begins.
_Avoid_: Prompt expansion, hidden system interpretation

**Decision Dossier**:
The traversable result of a **Decision Deliberation**, containing its recommendation, ranked alternatives, reasoning, evidence, assumptions, uncertainty, explored branches, confidence, and approval point.
_Avoid_: Final answer, report

**Human Approval**:
The explicit acceptance or rejection of the recommendation in a **Decision Dossier**. The system does not silently execute the recommended decision.
_Avoid_: Human in the loop

**Decision Branch**:
A possible route through a **Decision Deliberation**, identified by the accumulated consequences of its preceding questions and answers. Branches are equivalent only when their relevant accumulated consequences are equivalent.
_Avoid_: Agent thread, path

**Bounded Coverage**:
The completion state reached when every possibility within a declared decision space has been resolved or explicitly closed and no eligible possibilities remain.
_Avoid_: Exhaustive truth, every imaginable possibility

**Bootstrap Configuration**:
The initial policy for a **Decision Deliberation**, including its breadth, question budget, and whether it seeks **Bounded Coverage** or the strongest conclusions within a fixed number of rounds.
_Avoid_: Startup settings, system prompt

**Branch Expansion**:
The creation of one successor **Decision Branch** for every candidate answer admitted by a question. Each successor retains the accumulated consequences of its parent branch and its selected answer.
_Avoid_: Answer layer, agent spawning

**Candidate Answer**:
One atomic, mutually exclusive response admitted by a question. Decisions requiring combinations are expressed through subsequent questions rather than compound Candidate Answers.
_Avoid_: Choice bundle, multi-select answer

**Decision Frontier**:
The set of unresolved **Decision Branches** currently eligible for further examination.
_Avoid_: Queue, pending agents

**Branch Conclusion**:
The resolved outcome of one **Decision Branch**, interpreted in light of every preceding question and **Candidate Answer** on that branch.
_Avoid_: Leaf answer, agent response

**Decision Criterion**:
A named and weighted consideration used consistently to compare **Branch Conclusions** within one **Decision Deliberation**.
_Avoid_: Confidence, score prompt

**Hindsight Reduction**:
The leaf-to-root comparison of **Branch Conclusions** that reveals which earlier **Candidate Answers** lead to the strongest later outcomes.
_Avoid_: Final vote, root summary

**Partial Dossier**:
A **Decision Dossier** produced when a budget, safety limit, or unresolved failure stops exploration before **Bounded Coverage**. It preserves the best-known conclusions without claiming complete coverage.
_Avoid_: Completed dossier, failed report

## Example dialogue

**Developer:** Has the Decision Deliberation finished exploring the relevant possibilities?

**Domain expert:** Yes. Its Decision Dossier recommends PostgreSQL, ranks the alternatives, and preserves the evidence and assumptions behind every explored branch.

**Developer:** Did the system adopt PostgreSQL automatically?

**Domain expert:** No. The recommendation is waiting for Human Approval.

**Developer:** Can these two Decision Branches be merged because they reached the same question?

**Domain expert:** Only if their relevant accumulated consequences are also equivalent. Their question text alone does not establish equivalence.

**Developer:** Did we explore every admitted answer to this question?

**Domain expert:** Yes. Branch Expansion created a separate Decision Branch for each candidate answer, and Bounded Coverage requires every resulting branch to be resolved or explicitly closed.

**Developer:** We reached the question budget with three branches still on the Decision Frontier. Is the Decision Deliberation complete?

**Domain expert:** No. We can inspect a Partial Dossier, but it must not claim Bounded Coverage.

**Developer:** Why did the root recommendation change after deeper exploration?

**Domain expert:** Hindsight Reduction showed that a locally attractive Candidate Answer led to weaker Branch Conclusions.
