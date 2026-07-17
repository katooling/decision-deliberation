import type { AgentCallArtifact } from "../agents/structured-call.js";
import { assertSafeStoreId, type RunStore } from "./run-store.js";

interface MemoryRun {
  request: unknown;
  config: unknown;
  events: unknown[];
  calls: Map<string, AgentCallArtifact>;
  snapshot?: unknown;
  dossier?: unknown;
}

const clone = <T>(value: T): T => structuredClone(value);

export class MemoryRunStore implements RunStore {
  private readonly runs = new Map<string, MemoryRun>();

  async createRun(runId: string, request: unknown, config: unknown): Promise<string> {
    assertSafeStoreId(runId, "runId");
    if (this.runs.has(runId)) throw new Error(`run already exists: ${runId}`);
    this.runs.set(runId, { request: clone(request), config: clone(config), events: [], calls: new Map() });
    return runId;
  }

  async appendEvents(runId: string, events: readonly unknown[]): Promise<void> {
    this.get(runId).events.push(...events.map(clone));
  }

  async *readEvents(runId: string): AsyncIterable<unknown> {
    for (const event of this.get(runId).events) yield clone(event);
  }

  async writeCallArtifact(runId: string, artifact: AgentCallArtifact): Promise<void> {
    this.get(runId).calls.set(artifact.artifactId, clone(artifact));
  }

  async readCallArtifact(runId: string, artifactId: string): Promise<AgentCallArtifact | undefined> {
    const artifact = this.get(runId).calls.get(artifactId);
    return artifact === undefined ? undefined : clone(artifact);
  }

  async writeSnapshot(runId: string, snapshot: unknown): Promise<void> {
    this.get(runId).snapshot = clone(snapshot);
  }

  async readSnapshot(runId: string): Promise<unknown | undefined> {
    const snapshot = this.get(runId).snapshot;
    return snapshot === undefined ? undefined : clone(snapshot);
  }

  async writeDossier(runId: string, dossier: unknown): Promise<void> {
    this.get(runId).dossier = clone(dossier);
  }

  async readDossier(runId: string): Promise<unknown | undefined> {
    const dossier = this.get(runId).dossier;
    return dossier === undefined ? undefined : clone(dossier);
  }

  private get(runId: string): MemoryRun {
    const run = this.runs.get(runId);
    if (run === undefined) throw new Error(`unknown run: ${runId}`);
    return run;
  }
}
