import { createServer, type IncomingMessage, type Server } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

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

export interface LocalHttpResponse {
  status: number;
  contentType: string;
  body: string | Buffer;
  headers?: Readonly<Record<string, string>>;
}

export type LocalRequestHandler = (
  request: IncomingMessage,
  pathname: string,
) => Promise<LocalHttpResponse | undefined>;

export interface StartLocalServerOptions {
  handlers: readonly LocalRequestHandler[];
  host?: string;
  port?: number;
}

export interface LocalServerHandle {
  url: string;
  server: Server;
  close(): Promise<void>;
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

export function jsonResponse(
  status: number,
  value: unknown,
  headers?: Readonly<Record<string, string>>,
): LocalHttpResponse {
  return {
    status,
    contentType: "application/json; charset=utf-8",
    body: `${JSON.stringify(value)}\n`,
    ...(headers === undefined ? {} : { headers }),
  };
}

export async function staticResponse(root: string, name: string): Promise<LocalHttpResponse> {
  if (!name || name.includes("\0")) throw new HttpError(400, "Invalid static path");
  const candidate = resolve(root, name);
  if (!isWithin(root, candidate)) throw new HttpError(400, "Invalid static path");
  let canonical: string;
  try {
    canonical = await realpath(candidate);
    if (!isWithin(root, canonical) || !(await stat(canonical)).isFile()) {
      throw new HttpError(404, "Static file not found");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(404, "Static file not found");
    throw error;
  }
  return {
    status: 200,
    contentType: CONTENT_TYPES[extname(canonical).toLowerCase()] ?? "application/octet-stream",
    body: await readFile(canonical),
  };
}

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
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

function decodeRequestPath(request: IncomingMessage): string {
  const raw = (request.url ?? "/").split("?", 1)[0] ?? "/";
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, "Malformed request path");
  }
}

export async function startLocalServer(options: StartLocalServerOptions): Promise<LocalServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("port must be an integer from 0 to 65535");
  }
  if (options.handlers.length === 0) throw new Error("at least one request handler is required");

  const server = createServer((request, response) => {
    void (async () => {
      const pathname = decodeRequestPath(request);
      for (const handler of options.handlers) {
        const result = await handler(request, pathname);
        if (result === undefined) continue;
        for (const [name, value] of Object.entries(result.headers ?? {})) response.setHeader(name, value);
        for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
        response.statusCode = result.status;
        response.setHeader("content-type", result.contentType);
        response.setHeader("content-length", Buffer.byteLength(result.body));
        response.end(request.method === "HEAD" ? undefined : result.body);
        return;
      }
      throw new HttpError(404, "Not found");
    })().catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : "Internal decision application error";
      if (!response.headersSent) {
        for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
        const body = `${JSON.stringify({ error: message })}\n`;
        response.statusCode = status;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.setHeader("content-length", Buffer.byteLength(body));
        response.end(request.method === "HEAD" ? undefined : body);
      } else {
        response.destroy();
      }
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
    throw new Error("Local server did not expose a TCP address");
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
