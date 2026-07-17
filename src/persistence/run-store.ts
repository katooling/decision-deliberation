import type { AgentCallArtifact } from "../agents/structured-call.js";

export interface RunStore {
  createRun(runId: string, request: unknown, config: unknown): Promise<string>;
  appendEvents(runId: string, events: readonly unknown[]): Promise<void>;
  readEvents(runId: string): AsyncIterable<unknown>;
  writeCallArtifact(runId: string, artifact: AgentCallArtifact): Promise<void>;
  readCallArtifact(runId: string, artifactId: string): Promise<AgentCallArtifact | undefined>;
  writeSnapshot(runId: string, snapshot: unknown): Promise<void>;
  readSnapshot(runId: string): Promise<unknown | undefined>;
  writeDossier(runId: string, dossier: unknown): Promise<void>;
  readDossier(runId: string): Promise<unknown | undefined>;
}

export function assertSafeStoreId(value: string, label: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) {
    throw new Error(`${label} contains unsafe path characters`);
  }
}
