const $ = (selector) => document.querySelector(selector);

const views = ["start", "interview", "ready", "working", "result"];
const elements = {
  startForm: $("#start-form"),
  startButton: $("#start-button"),
  decision: $("#decision-input"),
  context: $("#context-input"),
  progress: $("#question-progress"),
  reflection: $("#reflection"),
  question: $("#question-text"),
  rationale: $("#question-rationale"),
  answerForm: $("#answer-form"),
  answer: $("#answer-input"),
  answerButton: $("#answer-button"),
  framingTitle: $("#framing-title"),
  framingStatement: $("#framing-statement"),
  criteria: $("#criteria-list"),
  deliberateButton: $("#deliberate-button"),
  resultTitle: $("#result-title"),
  resultStatement: $("#result-statement"),
  completeness: $("#completeness-badge"),
  recommendation: $("#recommendation-text"),
  recommendationSummary: $("#recommendation-summary"),
  score: $("#score-value"),
  confidence: $("#confidence-value"),
  conditions: $("#conditions-block"),
  caveats: $("#caveats-block"),
  metrics: $("#run-metrics"),
  alternatives: $("#alternatives-list"),
  assumptions: $("#assumptions-list"),
  tradeoffs: $("#tradeoffs-list"),
  evidence: $("#evidence-list"),
  uncertainty: $("#uncertainty-list"),
  adrLink: $("#adr-link"),
  treeLink: $("#tree-link"),
  error: $("#error-toast"),
  errorMessage: $("#error-message"),
  dismissError: $("#dismiss-error"),
};

let session = null;

function show(name) {
  for (const view of views) $(`#${view}-view`).hidden = view !== name;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function busy(button, active, label) {
  button.disabled = active;
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.textContent = active ? label : button.dataset.label;
}

function showError(error) {
  elements.errorMessage.textContent = error instanceof Error ? error.message : String(error);
  elements.error.hidden = false;
}

async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      if (payload.error) message = payload.error;
    } catch { /* bounded fallback */ }
    throw new Error(message);
  }
  return response.json();
}

function percent(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";
}

function completenessLabel(value) {
  return {
    coverage_complete: "Complete within bounds",
    partial_budget_exhausted: "Stopped at decision budget",
    partial_safety_limit: "Stopped at safety limit",
    partial_failure: "Stopped after a failed branch",
    in_progress: "Analysis in progress",
  }[value] || "Completeness unknown";
}

function fillList(target, values, empty) {
  target.replaceChildren();
  const source = values.length ? values : [empty];
  for (const value of source) {
    const item = document.createElement("li");
    item.textContent = value;
    target.append(item);
  }
}

function detailBlock(target, title, values) {
  target.replaceChildren();
  if (!values.length) return;
  const heading = document.createElement("h3");
  heading.textContent = title;
  const list = document.createElement("ul");
  fillList(list, values, "None recorded.");
  target.append(heading, list);
}

function renderSession(next) {
  session = next;
  if (next.status === "question") {
    elements.progress.textContent = `Question ${next.answers.length + 1}`;
    elements.reflection.textContent = next.reflection;
    elements.question.textContent = next.question.text;
    elements.rationale.textContent = next.question.rationale;
    elements.answer.value = "";
    show("interview");
    elements.answer.focus();
    return;
  }
  elements.framingTitle.textContent = next.framing.title;
  elements.framingStatement.textContent = next.framing.decisionStatement;
  elements.criteria.replaceChildren(...next.framing.criteria.map((criterion) => {
    const item = document.createElement("article");
    const weight = document.createElement("span");
    const title = document.createElement("strong");
    const description = document.createElement("p");
    weight.textContent = `${Math.round(criterion.weight * 100)}`;
    title.textContent = criterion.label;
    description.textContent = criterion.description;
    item.append(weight, title, description);
    return item;
  }));
  show("ready");
}

function renderResult(result) {
  const { dossier } = result;
  const recommendation = dossier.recommendation;
  elements.resultTitle.textContent = dossier.title;
  elements.resultStatement.textContent = dossier.decisionStatement;
  elements.completeness.textContent = completenessLabel(dossier.completeness);
  elements.completeness.className = `status-pill ${dossier.completeness === "coverage_complete" ? "complete" : "partial"}`;
  elements.recommendation.textContent = recommendation?.recommendation || "No scored recommendation is available.";
  elements.recommendationSummary.textContent = recommendation?.summary || "The bounded run did not produce a scored conclusion.";
  elements.score.textContent = percent(recommendation?.score);
  elements.confidence.textContent = percent(recommendation?.confidence);
  detailBlock(elements.conditions, "Conditions", recommendation?.conditions || []);
  detailBlock(elements.caveats, "Caveats", recommendation?.caveats || []);

  const metrics = [
    ["Branches", dossier.exploration.branchCount],
    ["Questions", dossier.exploration.questionCount],
    ["Evaluated paths", dossier.stats.evaluatedLeaves],
  ];
  elements.metrics.replaceChildren(...metrics.map(([label, value]) => {
    const wrapper = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = String(value);
    wrapper.append(term, detail);
    return wrapper;
  }));

  elements.alternatives.replaceChildren();
  const alternatives = dossier.rankedAlternatives.length
    ? dossier.rankedAlternatives
    : [{ rank: "—", recommendation: "No scored alternative", summary: "The run resolved without another scored path.", score: null, confidence: null }];
  for (const alternative of alternatives) {
    const card = document.createElement("article");
    const rank = document.createElement("span");
    const copy = document.createElement("div");
    const title = document.createElement("h3");
    const summary = document.createElement("p");
    const comparison = document.createElement("p");
    const score = document.createElement("small");
    rank.textContent = String(alternative.rank);
    title.textContent = alternative.recommendation;
    summary.textContent = alternative.summary;
    const scoreGap = recommendation && Number.isFinite(recommendation.score) && Number.isFinite(alternative.score)
      ? Math.max(0, Math.round((recommendation.score - alternative.score) * 100))
      : null;
    const caveat = alternative.caveats?.[0];
    comparison.className = "alternative-comparison";
    comparison.textContent = scoreGap === null
      ? caveat || "This path did not produce a comparable score."
      : `${scoreGap} points behind the recommendation after criteria and confidence adjustment.${caveat ? ` Main caveat: ${caveat}` : ""}`;
    score.textContent = alternative.score === null ? "Not scored" : `${percent(alternative.score)} score · ${percent(alternative.confidence)} confidence`;
    copy.append(title, summary, comparison, score);
    card.append(rank, copy);
    elements.alternatives.append(card);
  }

  fillList(elements.assumptions, dossier.reasoning.assumptions, "No assumption was recorded.");
  fillList(elements.tradeoffs, dossier.reasoning.tradeoffs, "No trade-off was recorded.");
  elements.evidence.replaceChildren();
  if (!dossier.evidence.length) {
    const empty = document.createElement("p");
    empty.textContent = "No external or supplied evidence was recorded.";
    elements.evidence.append(empty);
  } else {
    for (const evidence of dossier.evidence) {
      const item = document.createElement("article");
      const strength = document.createElement("span");
      const claim = document.createElement("p");
      const source = document.createElement("small");
      strength.textContent = evidence.strength;
      claim.textContent = evidence.claim;
      source.textContent = evidence.source;
      item.append(strength, claim, source);
      elements.evidence.append(item);
    }
  }
  fillList(elements.uncertainty, [
    ...dossier.uncertainty.sources,
    ...dossier.reasoning.unresolvedQuestions,
    ...dossier.uncertainty.unscoredBranchIds.map((id) => `Unscored branch: ${id}`),
  ], "No unresolved uncertainty was recorded.");
  elements.adrLink.href = `/api/product/runs/${encodeURIComponent(result.runId)}/adr`;
  elements.treeLink.href = `/viewer?run=${encodeURIComponent(result.runId)}`;
  show("result");
}

elements.startForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  busy(elements.startButton, true, "Finding the first question…");
  try {
    renderSession(await post("/api/product/sessions", {
      decision: elements.decision.value,
      context: elements.context.value,
    }));
  } catch (error) {
    showError(error);
  } finally {
    busy(elements.startButton, false, "Help me decide");
  }
});

elements.answerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!session) return;
  busy(elements.answerButton, true, "Thinking…");
  try {
    renderSession(await post(`/api/product/sessions/${encodeURIComponent(session.sessionId)}/answer`, {
      answer: elements.answer.value,
    }));
  } catch (error) {
    showError(error);
  } finally {
    busy(elements.answerButton, false, "Continue");
  }
});

elements.deliberateButton.addEventListener("click", async () => {
  if (!session) return;
  show("working");
  try {
    renderResult(await post(`/api/product/sessions/${encodeURIComponent(session.sessionId)}/deliberate`, {}));
  } catch (error) {
    showError(error);
    show("ready");
  }
});

elements.dismissError.addEventListener("click", () => { elements.error.hidden = true; });
