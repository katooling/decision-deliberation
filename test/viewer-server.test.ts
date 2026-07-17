import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BootstrapConfigurationSchema,
  DecisionRequestSchema,
  applyEvent,
  assembleDossier,
  createBranchConcludedEvent,
  createBranchEvaluatedEvent,
  createRunCompletedEvent,
  createRunCreatedEvent,
  type BranchEvaluation,
  type DecisionState,
} from "../src/index.js";
import { startViewerServer, type ViewerServerHandle } from "../src/viewer/server.js";

const temporaryPaths: string[] = [];
const servers: ViewerServerHandle[] = [];

test.afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporaryPaths.push(path);
  return path;
}

function fixtureState(runId: string, title: string): DecisionState {
  const request = DecisionRequestSchema.parse({
    schemaVersion: 1,
    title,
    decisionStatement: `Decide ${title}.`,
    context: "Viewer server fixture.",
    scope: { inScope: ["fixture"], outOfScope: [], constraints: [] },
    criteria: [{
      key: "utility",
      label: "Utility",
      description: "Outcome utility.",
      weight: 1,
      zeroAnchor: "No utility",
      oneAnchor: "Maximum utility",
    }],
  });
  const config = BootstrapConfigurationSchema.parse({
    schemaVersion: 1,
    completion: "coverage",
    traversal: "bfs",
    questionPipeline: { proposerCount: 1, reviewerCount: 1, synthesizerCount: 1 },
    options: { min: 2, target: 2, max: 3 },
    limits: { maxDepth: 2, maxNodes: 10, maxQuestions: 5, maxAgentCalls: 10 },
    concurrency: 2,
    maxAttemptsPerCall: 2,
    evaluatorCount: 1,
    confidencePenalty: 0,
  });
  const conclusion = {
    summary: `${title} conclusion.`,
    recommendation: `Choose ${title}.`,
    conditions: [],
    caveats: [],
    unresolvedQuestions: [],
  };
  const evaluation: BranchEvaluation = {
    schemaVersion: 1,
    conclusion,
    criterionScores: [{ criterionKey: "utility", score: 0.8, rationale: "Fixture." }],
    confidence: 0.9,
    evidence: [],
    assumptions: [],
    caveats: [],
  };
  let state = applyEvent(undefined, createRunCreatedEvent(runId, request, config));
  state = applyEvent(state, createBranchConcludedEvent(state, state.rootBranchId, conclusion));
  state = applyEvent(state, createBranchEvaluatedEvent(state, state.rootBranchId, 0, evaluation));
  state = applyEvent(state, createRunCompletedEvent(state, {
    classification: "coverage_complete",
    reasons: ["frontier_empty"],
  }));
  return state;
}

async function writeRun(root: string, state: DecisionState, withDossier = true): Promise<void> {
  const directory = join(root, state.runId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "graph.json"), JSON.stringify(state), "utf8");
  if (withDossier) {
    await writeFile(join(directory, "dossier.json"), JSON.stringify(assembleDossier(state)), "utf8");
  }
}

async function startFixtureServer(runsDirectory: string): Promise<ViewerServerHandle> {
  const staticDirectory = await temporaryDirectory("decision-viewer-static-");
  await writeFile(join(staticDirectory, "index.html"), "<!doctype html><title>Fixture viewer</title>", "utf8");
  await writeFile(join(staticDirectory, "app.js"), "export const ready = true;", "utf8");
  await writeFile(join(staticDirectory, "styles.css"), "body { color: black; }", "utf8");
  const handle = await startViewerServer({ runsDirectory, staticDirectory, port: 0 });
  servers.push(handle);
  return handle;
}

test("serves static viewer assets on loopback with restrictive headers", async () => {
  const runs = await temporaryDirectory("decision-viewer-runs-");
  const handle = await startFixtureServer(runs);
  const address = handle.server.address();
  assert.ok(address && typeof address !== "string");
  assert.equal(address.address, "127.0.0.1");
  assert.match(handle.url, /^http:\/\/127\.0\.0\.1:\d+$/);

  const page = await fetch(`${handle.url}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /^text\/html/);
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.match(await page.text(), /Fixture viewer/);

  const script = await fetch(`${handle.url}/viewer/app.js`);
  assert.match(script.headers.get("content-type") ?? "", /^text\/javascript/);
  assert.match(await script.text(), /ready = true/);

  const head = await fetch(`${handle.url}/viewer/styles.css`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.match(head.headers.get("content-type") ?? "", /^text\/css/);
  assert.equal(await head.text(), "");
});

test("lists stable summaries and derives a full bundle from graph and optional dossier", async () => {
  const runs = await temporaryDirectory("decision-viewer-runs-");
  await writeRun(runs, fixtureState("run-z", "Zeta"));
  await writeRun(runs, fixtureState("run-a", "Alpha"), false);
  await mkdir(join(runs, "unfinished-run"));
  const handle = await startFixtureServer(runs);

  const response = await fetch(`${handle.url}/api/runs`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const summaries = await response.json() as Array<Record<string, unknown>>;
  assert.deepEqual(summaries.map((item) => item.runId), ["run-a", "run-z"]);
  assert.deepEqual(summaries[0], {
    runId: "run-a",
    title: "Alpha",
    decisionStatement: "Decide Alpha.",
    completion: "coverage_complete",
    approvalStatus: "awaiting_human_approval",
    branchCount: 1,
    maxDepth: 0,
    winningAdjustedScore: 0.8,
    winningPathKey: "",
  });

  const bundleResponse = await fetch(`${handle.url}/api/runs/run-z`);
  assert.equal(bundleResponse.status, 200);
  const bundle = await bundleResponse.json() as Record<string, any>;
  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.run.runId, "run-z");
  assert.equal(bundle.summary.branchCount, 1);
  assert.equal(bundle.nodes[0].id, "branch_root");
  assert.equal(bundle.nodes[0].flags.isWinningLeaf, true);
});

test("rejects traversal and writes while returning bounded errors", async () => {
  const runs = await temporaryDirectory("decision-viewer-runs-");
  await writeRun(runs, fixtureState("safe-run", "Safe"));
  const handle = await startFixtureServer(runs);

  const runTraversal = await fetch(`${handle.url}/api/runs/..%2Foutside`);
  assert.equal(runTraversal.status, 400);
  assert.deepEqual(await runTraversal.json(), { error: "Invalid run ID" });

  const staticTraversal = await fetch(`${handle.url}/viewer/..%2Foutside.txt`);
  assert.equal(staticTraversal.status, 400);

  const missing = await fetch(`${handle.url}/api/runs/missing-run`);
  assert.equal(missing.status, 404);

  const productRoute = await fetch(`${handle.url}/api/product/sessions`);
  assert.equal(productRoute.status, 404);

  const write = await fetch(`${handle.url}/api/runs/safe-run`, { method: "POST", body: "{}" });
  assert.equal(write.status, 405);
  assert.equal(write.headers.get("allow"), "GET, HEAD");
  assert.equal(write.headers.get("cache-control"), "no-store");
});
