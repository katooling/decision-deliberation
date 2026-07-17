import type { IncomingMessage } from "node:http";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DecisionDossier } from "../core/dossier.js";
import type { DecisionState } from "../domain/state.js";
import {
  HttpError,
  isWithin,
  jsonResponse,
  type LocalRequestHandler,
  staticResponse,
} from "../http/local-server.js";
import { assertSafeStoreId } from "../persistence/run-store.js";
import { deriveViewerBundle } from "./bundle.js";
import type { DecisionViewerBundle } from "./types.js";

const DEFAULT_STATIC_DIRECTORY = fileURLToPath(new URL("./static", import.meta.url));

export interface ViewerRunSummary {
  runId: string;
  title: string;
  decisionStatement: string;
  completion: DecisionViewerBundle["run"]["completion"];
  approvalStatus: DecisionViewerBundle["run"]["approval"]["status"];
  branchCount: number;
  maxDepth: number;
  winningAdjustedScore: number | null;
  winningPathKey: string | null;
}

export interface CreateViewerHandlerOptions {
  runsDirectory: string;
  staticDirectory?: string;
  serveAtRoot?: boolean;
}

async function readJson<T>(path: string, containingDirectory: string): Promise<T> {
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(404, "Run artifact not found");
    throw error;
  }
  if (!isWithin(containingDirectory, canonicalPath)) throw new HttpError(400, "Unsafe artifact path");
  return JSON.parse(await readFile(canonicalPath, "utf8")) as T;
}

async function optionalDossier(runDirectory: string): Promise<DecisionDossier | undefined> {
  try {
    return await readJson<DecisionDossier>(resolve(runDirectory, "dossier.json"), runDirectory);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return undefined;
    throw error;
  }
}

async function resolveRunDirectory(runsRoot: string, runId: string): Promise<string> {
  try {
    assertSafeStoreId(runId, "runId");
  } catch {
    throw new HttpError(400, "Invalid run ID");
  }
  const candidate = resolve(runsRoot, runId);
  let canonical: string;
  try {
    canonical = await realpath(candidate);
    if (!(await stat(canonical)).isDirectory()) throw new HttpError(404, "Run not found");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(404, "Run not found");
    throw error;
  }
  if (!isWithin(runsRoot, canonical) || canonical === runsRoot) throw new HttpError(400, "Unsafe run path");
  return canonical;
}

async function loadBundle(runsRoot: string, runId: string): Promise<DecisionViewerBundle> {
  const runDirectory = await resolveRunDirectory(runsRoot, runId);
  const state = await readJson<DecisionState>(resolve(runDirectory, "graph.json"), runDirectory);
  return deriveViewerBundle(state, await optionalDossier(runDirectory));
}

function summarize(bundle: DecisionViewerBundle): ViewerRunSummary {
  const winner = bundle.summary.winningBranchId
    ? bundle.nodes.find((node) => node.id === bundle.summary.winningBranchId)
    : undefined;
  return {
    runId: bundle.run.runId,
    title: bundle.run.title,
    decisionStatement: bundle.run.decisionStatement,
    completion: bundle.run.completion,
    approvalStatus: bundle.run.approval.status,
    branchCount: bundle.summary.branchCount,
    maxDepth: bundle.summary.maxDepth,
    winningAdjustedScore: bundle.summary.winningAdjustedScore,
    winningPathKey: winner?.pathKey ?? null,
  };
}

async function listRuns(runsRoot: string): Promise<ViewerRunSummary[]> {
  const entries = await readdir(runsRoot, { withFileTypes: true });
  const summaries: ViewerRunSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      assertSafeStoreId(entry.name, "runId");
    } catch {
      continue;
    }
    try {
      summaries.push(summarize(await loadBundle(runsRoot, entry.name)));
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) continue;
      throw error;
    }
  }
  return summaries.sort(
    (left, right) => left.title.localeCompare(right.title) || left.runId.localeCompare(right.runId),
  );
}

export async function createViewerRequestHandler(
  options: CreateViewerHandlerOptions,
): Promise<LocalRequestHandler> {
  const runsRoot = await realpath(resolve(options.runsDirectory));
  if (!(await stat(runsRoot)).isDirectory()) throw new Error("runsDirectory must be a directory");
  const staticRoot = await realpath(resolve(options.staticDirectory ?? DEFAULT_STATIC_DIRECTORY));
  if (!(await stat(staticRoot)).isDirectory()) throw new Error("staticDirectory must be a directory");
  const serveAtRoot = options.serveAtRoot ?? true;

  return async (request: IncomingMessage, pathname: string) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonResponse(405, { error: "Method not allowed" }, { allow: "GET, HEAD" });
    }
    if (pathname === "/api/runs") return jsonResponse(200, await listRuns(runsRoot));
    if (pathname.startsWith("/api/runs/")) {
      return jsonResponse(200, await loadBundle(runsRoot, pathname.slice("/api/runs/".length)));
    }
    if (serveAtRoot && pathname === "/") return staticResponse(staticRoot, "index.html");
    if (pathname === "/viewer" || pathname === "/viewer/") return staticResponse(staticRoot, "index.html");
    if (pathname.startsWith("/viewer/")) return staticResponse(staticRoot, pathname.slice("/viewer/".length));
    return undefined;
  };
}
