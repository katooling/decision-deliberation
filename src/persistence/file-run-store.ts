import { createReadStream } from "node:fs";
import { appendFile, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

import type { AgentCallArtifact } from "../agents/structured-call.js";
import { assertSafeStoreId, type RunStore } from "./run-store.js";

let tempCounter = 0;

async function atomicJson(path: string, value: unknown): Promise<void> {
  tempCounter += 1;
  const temp = `${path}.tmp-${process.pid}-${tempCounter}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

async function optionalJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Append-only JSONL event store with atomic materialized artifacts. */
export class FileRunStore implements RunStore {
  private readonly appendQueues = new Map<string, Promise<void>>();

  constructor(readonly rootDirectory: string) {}

  async createRun(runId: string, request: unknown, config: unknown): Promise<string> {
    assertSafeStoreId(runId, "runId");
    await mkdir(this.rootDirectory, { recursive: true });
    const directory = this.runDirectory(runId);
    await mkdir(directory);
    await mkdir(join(directory, "calls"));
    await atomicJson(join(directory, "request.json"), request);
    await atomicJson(join(directory, "config.json"), config);
    const handle = await open(join(directory, "events.jsonl"), "wx");
    await handle.close();
    return runId;
  }

  async appendEvents(runId: string, events: readonly unknown[]): Promise<void> {
    if (events.length === 0) return;
    const previous = this.appendQueues.get(runId) ?? Promise.resolve();
    const next = previous.then(async () => {
      const payload = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
      await appendFile(join(this.runDirectory(runId), "events.jsonl"), payload, "utf8");
    });
    this.appendQueues.set(runId, next.catch(() => undefined));
    return next;
  }

  async *readEvents(runId: string): AsyncIterable<unknown> {
    await this.appendQueues.get(runId);
    const stream = createReadStream(join(this.runDirectory(runId), "events.jsonl"), { encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lines) {
      if (line.trim().length > 0) yield JSON.parse(line) as unknown;
    }
  }

  async writeCallArtifact(runId: string, artifact: AgentCallArtifact): Promise<void> {
    assertSafeStoreId(artifact.artifactId, "artifactId");
    await atomicJson(join(this.runDirectory(runId), "calls", `${artifact.artifactId}.json`), artifact);
  }

  async readCallArtifact(runId: string, artifactId: string): Promise<AgentCallArtifact | undefined> {
    assertSafeStoreId(artifactId, "artifactId");
    return (await optionalJson(join(this.runDirectory(runId), "calls", `${artifactId}.json`))) as
      | AgentCallArtifact
      | undefined;
  }

  async writeSnapshot(runId: string, snapshot: unknown): Promise<void> {
    await atomicJson(join(this.runDirectory(runId), "graph.json"), snapshot);
  }

  readSnapshot(runId: string): Promise<unknown | undefined> {
    return optionalJson(join(this.runDirectory(runId), "graph.json"));
  }

  async writeDossier(runId: string, dossier: unknown): Promise<void> {
    await atomicJson(join(this.runDirectory(runId), "dossier.json"), dossier);
  }

  readDossier(runId: string): Promise<unknown | undefined> {
    return optionalJson(join(this.runDirectory(runId), "dossier.json"));
  }

  private runDirectory(runId: string): string {
    assertSafeStoreId(runId, "runId");
    return join(this.rootDirectory, runId);
  }
}
