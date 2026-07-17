import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { DecisionDossier } from "../core/dossier.js";
import type { DecisionState } from "../domain/state.js";
import { assertSafeStoreId } from "../persistence/run-store.js";
import { ProductWorkflowError, type DecisionProduct } from "../product/workflow.js";
import { deriveViewerBundle } from "./bundle.js";
import type { DecisionViewerBundle } from "./types.js";

const DEFAULT_STATIC_DIRECTORY = fileURLToPath(new URL("./static", import.meta.url));
const DEFAULT_PRODUCT_STATIC_DIRECTORY = fileURLToPath(new URL("../product/static", import.meta.url));
const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

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

export interface StartViewerServerOptions {
  runsDirectory: string;
  host?: string;
  port?: number;
  staticDirectory?: string;
  product?: DecisionProduct;
  productStaticDirectory?: string;
}

export interface ViewerServerHandle {
  url: string;
  server: Server;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function setCommonHeaders(response: ServerResponse): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
}

function send(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string | Buffer,
): void {
  setCommonHeaders(response);
  response.statusCode = status;
  response.setHeader("content-type", contentType);
  response.setHeader("content-length", Buffer.byteLength(body));
  response.end(request.method === "HEAD" ? undefined : body);
}

function sendJson(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  send(request, response, status, "application/json; charset=utf-8", `${JSON.stringify(value)}\n`);
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

async function optionalDossier(
  runDirectory: string,
): Promise<DecisionDossier | undefined> {
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

function decodeRequestPath(request: IncomingMessage): string {
  const raw = (request.url ?? "/").split("?", 1)[0] ?? "/";
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, "Malformed request path");
  }
}

async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  staticRoot: string,
  pathname: string,
  productStaticRoot?: string,
): Promise<void> {
  let name: string;
  let selectedRoot = staticRoot;
  if (productStaticRoot !== undefined && pathname === "/") {
    selectedRoot = productStaticRoot;
    name = "index.html";
  } else if (productStaticRoot !== undefined && pathname.startsWith("/app/")) {
    selectedRoot = productStaticRoot;
    name = pathname.slice("/app/".length);
  } else if (pathname === "/" || pathname === "/viewer" || pathname === "/viewer/") {
    name = "index.html";
  } else if (pathname.startsWith("/viewer/")) {
    name = pathname.slice("/viewer/".length);
  } else {
    throw new HttpError(404, "Not found");
  }
  if (!name || name.includes("\0")) throw new HttpError(400, "Invalid static path");
  const candidate = resolve(selectedRoot, name);
  if (!isWithin(selectedRoot, candidate)) throw new HttpError(400, "Invalid static path");
  let canonical: string;
  try {
    canonical = await realpath(candidate);
    if (!isWithin(selectedRoot, canonical) || !(await stat(canonical)).isFile()) {
      throw new HttpError(404, "Static file not found");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(404, "Static file not found");
    throw error;
  }
  const contentType = CONTENT_TYPES[extname(canonical).toLowerCase()] ?? "application/octet-stream";
  send(request, response, 200, contentType, await readFile(canonical));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (!(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 64 * 1024) throw new HttpError(413, "JSON request body is too large");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as unknown;
  } catch {
    throw new HttpError(400, "Request body must contain valid JSON");
  }
}

function assertSameOriginWrite(request: IncomingMessage): void {
  if (request.headers["sec-fetch-site"] === "cross-site") {
    throw new HttpError(403, "Cross-site writes are not allowed");
  }
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (typeof origin !== "string" || typeof host !== "string") {
    throw new HttpError(403, "Product writes require a same-origin browser request");
  }
  try {
    const parsed = new URL(origin);
    const requestedHost = new URL(`http://${host}`).hostname;
    if (
      parsed.protocol !== "http:" ||
      parsed.host !== host ||
      !["127.0.0.1", "localhost", "[::1]"].includes(requestedHost)
    ) {
      throw new HttpError(403, "Cross-site writes are not allowed");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(403, "Cross-site writes are not allowed");
  }
}

async function handleProductWrite(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  product: DecisionProduct,
): Promise<void> {
  assertSameOriginWrite(request);
  if (pathname === "/api/product/sessions") {
    sendJson(request, response, 201, await product.begin(await readJsonBody(request)));
    return;
  }
  const answer = pathname.match(/^\/api\/product\/sessions\/([^/]+)\/answer$/);
  if (answer?.[1] !== undefined) {
    sendJson(request, response, 200, await product.answer(answer[1], await readJsonBody(request)));
    return;
  }
  const deliberate = pathname.match(/^\/api\/product\/sessions\/([^/]+)\/deliberate$/);
  if (deliberate?.[1] !== undefined) {
    await readJsonBody(request);
    sendJson(request, response, 201, await product.deliberate(deliberate[1]));
    return;
  }
  throw new HttpError(404, "Product route not found");
}

export async function startViewerServer(
  options: StartViewerServerOptions,
): Promise<ViewerServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error("port must be an integer from 0 to 65535");
  const runsRoot = await realpath(resolve(options.runsDirectory));
  if (!(await stat(runsRoot)).isDirectory()) throw new Error("runsDirectory must be a directory");
  const staticRoot = await realpath(resolve(options.staticDirectory ?? DEFAULT_STATIC_DIRECTORY));
  if (!(await stat(staticRoot)).isDirectory()) throw new Error("staticDirectory must be a directory");
  const productStaticRoot = options.product === undefined
    ? undefined
    : await realpath(resolve(options.productStaticDirectory ?? DEFAULT_PRODUCT_STATIC_DIRECTORY));
  if (productStaticRoot !== undefined && !(await stat(productStaticRoot)).isDirectory()) {
    throw new Error("productStaticDirectory must be a directory");
  }

  const server = createServer((request, response) => {
    void (async () => {
      const pathname = decodeRequestPath(request);
      if (request.method === "POST" && options.product !== undefined && pathname.startsWith("/api/product/")) {
        await handleProductWrite(request, response, pathname, options.product);
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("allow", "GET, HEAD");
        sendJson(request, response, 405, { error: "Method not allowed" });
        return;
      }
      if (options.product !== undefined && pathname.startsWith("/api/product/runs/") && pathname.endsWith("/adr")) {
        const runId = pathname.slice("/api/product/runs/".length, -"/adr".length);
        const adr = await options.product.exportAdr(runId);
        response.setHeader("content-disposition", `attachment; filename="${runId}.md"`);
        send(request, response, 200, "text/markdown; charset=utf-8", adr);
        return;
      }
      if (pathname === "/api/runs") {
        sendJson(request, response, 200, await listRuns(runsRoot));
        return;
      }
      if (pathname.startsWith("/api/runs/")) {
        const runId = pathname.slice("/api/runs/".length);
        sendJson(request, response, 200, await loadBundle(runsRoot, runId));
        return;
      }
      await serveStatic(request, response, staticRoot, pathname, productStaticRoot);
    })().catch((error: unknown) => {
      const status = error instanceof HttpError || error instanceof ProductWorkflowError
        ? error.status
        : 500;
      const message = error instanceof HttpError || error instanceof ProductWorkflowError
        ? error.message
        : "Internal decision application error";
      if (!response.headersSent) sendJson(request, response, status, { error: message });
      else response.destroy();
    });
  });

  await new Promise<void>((resolveListen, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Viewer server did not expose a TCP address");
  }
  const urlHost = address.family === "IPv6" ? `[${address.address}]` : address.address;
  let closed = false;
  return {
    url: `http://${urlHost}:${address.port}`,
    server,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => error ? reject(error) : resolveClose());
      });
    },
  };
}
