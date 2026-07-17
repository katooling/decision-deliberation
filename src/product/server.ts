import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import {
  startViewerServer,
  type ViewerServerHandle,
} from "../viewer/server.js";
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
  return startViewerServer({
    runsDirectory: options.runsDirectory,
    product: options.product,
    ...(options.host === undefined ? {} : { host: options.host }),
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.viewerStaticDirectory === undefined
      ? {}
      : { staticDirectory: options.viewerStaticDirectory }),
    ...(options.productStaticDirectory === undefined
      ? {}
      : { productStaticDirectory: options.productStaticDirectory }),
  });
}
