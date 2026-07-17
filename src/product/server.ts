import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { startLocalServer } from "../http/local-server.js";
import {
  type ViewerServerHandle,
} from "../viewer/server.js";
import { createViewerRequestHandler } from "../viewer/http-handler.js";
import { createProductRequestHandler } from "./http-handler.js";
import type { DecisionProduct } from "./workflow.js";

export interface StartDecisionAppServerOptions {
  runsDirectory: string;
  product: DecisionProduct;
  host?: string;
  port?: number;
  viewerStaticDirectory?: string;
  productStaticDirectory?: string;
}

/** Start the write-enabled product experience while retaining the read-only viewer routes. */
export async function startDecisionAppServer(
  options: StartDecisionAppServerOptions,
): Promise<ViewerServerHandle> {
  await mkdir(resolve(options.runsDirectory), { recursive: true });
  const [productHandler, viewerHandler] = await Promise.all([
    createProductRequestHandler({
      product: options.product,
      ...(options.productStaticDirectory === undefined
        ? {}
        : { staticDirectory: options.productStaticDirectory }),
    }),
    createViewerRequestHandler({
      runsDirectory: options.runsDirectory,
      serveAtRoot: false,
      ...(options.viewerStaticDirectory === undefined
        ? {}
        : { staticDirectory: options.viewerStaticDirectory }),
    }),
  ]);
  return startLocalServer({
    handlers: [productHandler, viewerHandler],
    ...(options.host === undefined ? {} : { host: options.host }),
    ...(options.port === undefined ? {} : { port: options.port }),
  });
}
