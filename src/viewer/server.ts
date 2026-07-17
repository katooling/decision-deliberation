import { type LocalServerHandle, startLocalServer } from "../http/local-server.js";
import { createViewerRequestHandler, type ViewerRunSummary } from "./http-handler.js";

export interface StartViewerServerOptions {
  runsDirectory: string;
  host?: string;
  port?: number;
  staticDirectory?: string;
}

export type ViewerServerHandle = LocalServerHandle;
export type { ViewerRunSummary };

export async function startViewerServer(
  options: StartViewerServerOptions,
): Promise<ViewerServerHandle> {
  const handler = await createViewerRequestHandler(options);
  return startLocalServer({
    handlers: [handler],
    ...(options.host === undefined ? {} : { host: options.host }),
    ...(options.port === undefined ? {} : { port: options.port }),
  });
}
