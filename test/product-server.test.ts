import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AgentRequest } from "../src/agents/provider.js";
import type { BootstrapConfiguration, DecisionRequest } from "../src/domain/schemas.js";
import { FileRunStore } from "../src/persistence/file-run-store.js";
import { startDecisionAppServer } from "../src/product/server.js";
import { DecisionProduct } from "../src/product/workflow.js";
import { ScriptedProvider } from "../src/providers/scripted-provider.js";

const config: BootstrapConfiguration = {
  schemaVersion: 1,
  completion: "coverage",
  traversal: "bfs",
  questionPipeline: { proposerCount: 1, reviewerCount: 1, synthesizerCount: 1 },
  options: { min: 2, target: 2, max: 3 },
  limits: { maxDepth: 1, maxNodes: 8, maxQuestions: 2, maxAgentCalls: 12 },
  concurrency: 1,
  maxAttemptsPerCall: 1,
  evaluatorCount: 1,
  confidencePenalty: 0,
};

const framing: DecisionRequest = {
  schemaVersion: 1,
  title: "Choose the first product surface",
  decisionStatement: "Should the team launch the API or dashboard first?",
  context: "The first release must validate demand within six weeks.",
  scope: {
    inScope: ["API", "Dashboard"],
    outOfScope: ["Target-market changes"],
    constraints: ["Four engineers", "Six weeks"],
  },
  criteria: [
    {
      key: "learning",
      label: "Validated learning",
      description: "How quickly the release tests the riskiest demand assumption.",
      weight: 0.7,
      zeroAnchor: "No demand signal",
      oneAnchor: "Repeated paid usage",
    },
    {
      key: "reversibility",
      label: "Reversibility",
      description: "How cheaply the team can change direction.",
      weight: 0.3,
      zeroAnchor: "Expensive to reverse",
      oneAnchor: "Cheap to reverse",
    },
  ],
};

const conclusion = {
  summary: "A narrow API pilot validates demand before interface investment.",
  recommendation: "Launch the API pilot first.",
  conditions: ["Recruit two design partners."],
  caveats: ["Dashboard usability remains untested."],
  unresolvedQuestions: ["Which authentication path is simplest?"],
};

function provider(): ScriptedProvider {
  return new ScriptedProvider((request: AgentRequest) => {
    switch (request.role) {
      case "decision-interviewer": {
        const answers = (request.input as { answers: unknown[] }).answers;
        return JSON.stringify({
          schemaVersion: 1,
          reflection: answers.length === 0 ? "The success condition is missing." : "The decision is ready to frame.",
          ready: answers.length > 0,
          question: answers.length === 0 ? "What outcome would make this successful?" : null,
          rationale: answers.length === 0 ? "The answer determines the comparison criteria." : null,
        });
      }
      case "decision-framer":
        return JSON.stringify(framing);
      case "question-proposer":
      case "question-synthesizer":
        return JSON.stringify({ schemaVersion: 1, resolution: { type: "conclude", conclusion } });
      case "coverage-reviewer":
        return JSON.stringify({
          schemaVersion: 1,
          findings: { missingAngles: [], overlaps: [], atomicityIssues: [], exclusivityIssues: [], pathContextRisks: [] },
          synthesisInstructions: ["Conclude the bounded fixture."],
          preferredProposalIndexes: [0],
        });
      case "branch-evaluator":
        return JSON.stringify({
          schemaVersion: 1,
          conclusion,
          criterionScores: [
            { criterionKey: "learning", score: 0.84, rationale: "The pilot tests demand." },
            { criterionKey: "reversibility", score: 0.9, rationale: "The pilot avoids full interface commitment." },
          ],
          confidence: 0.8,
          evidence: [{ claim: "The pilot tests the risky assumption.", source: "Supplied context", strength: "moderate" }],
          assumptions: ["Design partners are representative."],
          caveats: ["This is bounded evidence."],
        });
      case "baseline-designer":
        throw new Error("Unexpected benchmark role");
    }
  });
}

test("local product page completes intake, interview, dossier, ADR, and reasoning navigation", async () => {
  const runs = await mkdtemp(join(tmpdir(), "decision-product-server-"));
  const product = new DecisionProduct({
    provider: provider(),
    store: new FileRunStore(runs),
    config,
    maxQuestions: 3,
  });
  const app = await startDecisionAppServer({ runsDirectory: runs, product, port: 0 });
  try {
    const page = await fetch(app.url);
    assert.equal(page.status, 200);
    const pageText = await page.text();
    assert.match(pageText, /Grill me until we both know the answer/);
    assert.match(pageText, /sent to the configured model/);
    assert.doesNotMatch(pageText, /Private local workspace|stays local/);

    const script = await fetch(`${app.url}/app/app.js`);
    assert.equal(script.status, 200);
    const scriptText = await script.text();
    assert.match(scriptText, /Help me decide/);
    assert.match(scriptText, /Stopped at decision budget/);
    assert.match(scriptText, /points behind the recommendation/);
    assert.doesNotMatch(scriptText, /Bounded coverage|Partial evidence/);

    const appTraversal = await fetch(`${app.url}/app/..%2Foutside.txt`);
    assert.equal(appTraversal.status, 400);

    const unsupportedRead = await fetch(`${app.url}/api/product/sessions`);
    assert.equal(unsupportedRead.status, 405);
    assert.equal(unsupportedRead.headers.get("allow"), "POST");

    const rejected = await fetch(`${app.url}/api/product/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ decision: framing.decisionStatement }),
    });
    assert.equal(rejected.status, 403);

    const rebound = await fetch(`${app.url}/api/product/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "attacker.example",
        origin: "http://attacker.example",
      },
      body: JSON.stringify({ decision: framing.decisionStatement }),
    });
    assert.equal(rebound.status, 403);

    const begin = await fetch(`${app.url}/api/product/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: app.url },
      body: JSON.stringify({ decision: framing.decisionStatement, context: framing.context }),
    });
    assert.equal(begin.status, 201);
    const question = await begin.json() as { sessionId: string; status: string; question: { text: string } };
    assert.equal(question.status, "question");
    assert.match(question.question.text, /outcome/);

    const answer = await fetch(`${app.url}/api/product/sessions/${question.sessionId}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: app.url },
      body: JSON.stringify({ answer: "Two design partners use it weekly and ask to pay." }),
    });
    assert.equal(answer.status, 200);
    assert.equal((await answer.json() as { status: string }).status, "ready");

    const deliberation = await fetch(`${app.url}/api/product/sessions/${question.sessionId}/deliberate`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: app.url },
      body: "{}",
    });
    assert.equal(deliberation.status, 201);
    const result = await deliberation.json() as {
      status: string;
      runId: string;
      dossier: { recommendation: { recommendation: string } };
    };
    assert.equal(result.status, "complete");
    assert.equal(result.dossier.recommendation.recommendation, conclusion.recommendation);

    const adr = await fetch(`${app.url}/api/product/runs/${result.runId}/adr`);
    assert.equal(adr.status, 200);
    assert.match(adr.headers.get("content-type") ?? "", /^text\/markdown/);
    assert.match(adr.headers.get("content-disposition") ?? "", /^attachment;/);
    assert.match(await adr.text(), /Launch the API pilot first/);

    const invalidAdr = await fetch(`${app.url}/api/product/runs/not-a-product-run/adr`);
    assert.equal(invalidAdr.status, 400);
    assert.deepEqual(await invalidAdr.json(), { error: "Invalid run ID" });

    const reasoning = await fetch(`${app.url}/api/runs/${result.runId}`);
    assert.equal(reasoning.status, 200);
    assert.equal((await reasoning.json() as { run: { runId: string } }).run.runId, result.runId);
    assert.equal((await fetch(`${app.url}/viewer?run=${result.runId}`)).status, 200);

    const viewerWrite = await fetch(`${app.url}/api/runs/${result.runId}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: app.url },
      body: "{}",
    });
    assert.equal(viewerWrite.status, 405);
  } finally {
    await app.close();
    await rm(runs, { recursive: true, force: true });
  }
});
