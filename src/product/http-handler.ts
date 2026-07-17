import type { IncomingMessage } from "node:http";
import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HttpError,
  jsonResponse,
  type LocalRequestHandler,
  readJsonBody,
  staticResponse,
} from "../http/local-server.js";
import { ProductWorkflowError, type DecisionProduct } from "./workflow.js";

const DEFAULT_PRODUCT_STATIC_DIRECTORY = fileURLToPath(new URL("./static", import.meta.url));

export interface CreateProductHandlerOptions {
  product: DecisionProduct;
  staticDirectory?: string;
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

function workflowError(error: unknown): never {
  if (error instanceof ProductWorkflowError) throw new HttpError(error.status, error.message);
  throw error;
}

export async function createProductRequestHandler(
  options: CreateProductHandlerOptions,
): Promise<LocalRequestHandler> {
  const staticRoot = await realpath(resolve(options.staticDirectory ?? DEFAULT_PRODUCT_STATIC_DIRECTORY));
  if (!(await stat(staticRoot)).isDirectory()) throw new Error("productStaticDirectory must be a directory");

  return async (request: IncomingMessage, pathname: string) => {
    try {
      if (pathname === "/" || pathname.startsWith("/app/")) {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return jsonResponse(405, { error: "Method not allowed" }, { allow: "GET, HEAD" });
        }
        return staticResponse(staticRoot, pathname === "/" ? "index.html" : pathname.slice("/app/".length));
      }

      if (!pathname.startsWith("/api/product/")) return undefined;
      const adr = pathname.match(/^\/api\/product\/runs\/([^/]+)\/adr$/);
      if (adr?.[1] !== undefined && (request.method === "GET" || request.method === "HEAD")) {
        return {
          status: 200,
          contentType: "text/markdown; charset=utf-8",
          body: await options.product.exportAdr(adr[1]),
          headers: { "content-disposition": `attachment; filename="${adr[1]}.md"` },
        };
      }
      if (request.method !== "POST") {
        return jsonResponse(405, { error: "Method not allowed" }, { allow: adr ? "GET, HEAD" : "POST" });
      }

      assertSameOriginWrite(request);
      if (pathname === "/api/product/sessions") {
        return jsonResponse(201, await options.product.begin(await readJsonBody(request)));
      }
      const answer = pathname.match(/^\/api\/product\/sessions\/([^/]+)\/answer$/);
      if (answer?.[1] !== undefined) {
        return jsonResponse(200, await options.product.answer(answer[1], await readJsonBody(request)));
      }
      const deliberate = pathname.match(/^\/api\/product\/sessions\/([^/]+)\/deliberate$/);
      if (deliberate?.[1] !== undefined) {
        await readJsonBody(request);
        return jsonResponse(201, await options.product.deliberate(deliberate[1]));
      }
      throw new HttpError(404, "Product route not found");
    } catch (error) {
      workflowError(error);
    }
  };
}
