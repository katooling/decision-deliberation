#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

import {
  BootstrapConfigurationSchema,
  DecisionRequestSchema,
} from "./domain/schemas.js";
import { runSyntheticBenchmark, renderBenchmarkMarkdown } from "./benchmark/index.js";
import { runBaselineSeries, type BaselineArm } from "./benchmark/baseline.js";
import { renderPairedBenchmarkMarkdown, runPairedBenchmark } from "./benchmark/live.js";
import { DecisionEngine } from "./orchestration/engine.js";
import { FileRunStore } from "./persistence/file-run-store.js";
import { CommandProvider } from "./providers/command-provider.js";
import { CodexCliProvider } from "./providers/codex-cli-provider.js";
import { ScriptedProvider } from "./providers/scripted-provider.js";
import { renderDossierMarkdown } from "./render/markdown.js";
import { VERSION } from "./version.js";
import { startViewerServer } from "./viewer/server.js";

type Flags = Record<string, string | boolean>;

function parseArguments(args: string[]): { command: string; positional: string[]; flags: Flags } {
  const [command = "help", ...rest] = args;
  const positional: string[] = [];
  const flags: Flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === undefined) continue;
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = rest[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      index += 1;
    }
  }
  return { command, positional, flags };
}

function requiredFlag(flags: Flags, name: string): string {
  const value = flags[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
}

async function loadProvider(path: string) {
  const config = await readJson(path);
  if (typeof config !== "object" || config === null || !("type" in config)) {
    throw new Error("provider config must be an object with a type field");
  }
  const value = config as Record<string, unknown>;
  if (value.type === "command") {
    if (typeof value.command !== "string") throw new Error("command provider requires command");
    return new CommandProvider({
      command: value.command,
      ...(Array.isArray(value.args) && value.args.every((item) => typeof item === "string")
        ? { args: value.args as string[] }
        : {}),
      ...(typeof value.cwd === "string" ? { cwd: value.cwd } : {}),
      ...(typeof value.timeoutMs === "number" ? { timeoutMs: value.timeoutMs } : {}),
    });
  }
  if (value.type === "codex-cli") {
    return new CodexCliProvider({
      ...(typeof value.codexBin === "string" ? { codexBin: value.codexBin } : {}),
      ...(typeof value.model === "string" ? { model: value.model } : {}),
      ...(typeof value.timeoutMs === "number" ? { timeoutMs: value.timeoutMs } : {}),
      ...(typeof value.maxOutputBytes === "number"
        ? { maxOutputBytes: value.maxOutputBytes }
        : {}),
    });
  }
  if (value.type === "scripted" && (Array.isArray(value.responses) || typeof value.responses === "object")) {
    return new ScriptedProvider(value.responses as ConstructorParameters<typeof ScriptedProvider>[0]);
  }
  throw new Error(`unsupported provider type: ${String(value.type)}`);
}

function dormantProvider(): ScriptedProvider {
  return new ScriptedProvider(() => new Error("this command must not invoke an agent"));
}

async function writeMarkdownDossier(root: string, runId: string, markdown: string): Promise<string> {
  const path = join(resolve(root), runId, "dossier.md");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, markdown, "utf8");
  return path;
}

async function runCommand(positional: string[], flags: Flags): Promise<void> {
  const requestPath = positional[0];
  if (!requestPath) throw new Error("run requires a request JSON path");
  const configPath = requiredFlag(flags, "config");
  const providerPath = requiredFlag(flags, "provider");
  const outputRoot = typeof flags.out === "string" ? flags.out : "runs";
  const request = DecisionRequestSchema.parse(await readJson(requestPath));
  const config = BootstrapConfigurationSchema.parse(await readJson(configPath));
  const provider = await loadProvider(providerPath);
  const engine = new DecisionEngine({ store: new FileRunStore(resolve(outputRoot)), provider });
  const runId = await engine.create(
    request,
    config,
    typeof flags["run-id"] === "string" ? flags["run-id"] : undefined,
  );
  const dossier = await engine.run(runId);
  const markdownPath = await writeMarkdownDossier(
    outputRoot,
    runId,
    renderDossierMarkdown(dossier),
  );
  process.stdout.write(
    `${JSON.stringify({ runId, completeness: dossier.completeness, recommendation: dossier.recommendation?.recommendation ?? null, dossier: markdownPath }, null, 2)}\n`,
  );
}

async function replayCommand(flags: Flags): Promise<void> {
  const root = typeof flags.out === "string" ? flags.out : "runs";
  const runId = requiredFlag(flags, "run-id");
  const engine = new DecisionEngine({
    store: new FileRunStore(resolve(root)),
    provider: dormantProvider(),
  });
  const state = await engine.replay(runId);
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
}

async function statusCommand(flags: Flags): Promise<void> {
  const root = typeof flags.out === "string" ? flags.out : "runs";
  const runId = requiredFlag(flags, "run-id");
  const engine = new DecisionEngine({
    store: new FileRunStore(resolve(root)),
    provider: dormantProvider(),
  });
  const state = await engine.replay(runId);
  const frontier = Object.values(state.branches).filter((branch) => branch.status === "frontier");
  process.stdout.write(`${JSON.stringify({
    runId,
    completion: state.completion,
    approval: state.approval,
    branches: Object.keys(state.branches).length,
    questions: Object.keys(state.expansions).length,
    frontier: frontier.map((branch) => branch.id),
    usage: state.usage,
  }, null, 2)}\n`);
}

async function approveCommand(flags: Flags): Promise<void> {
  const root = typeof flags.out === "string" ? flags.out : "runs";
  const runId = requiredFlag(flags, "run-id");
  const decision = requiredFlag(flags, "decision");
  if (decision !== "approved" && decision !== "rejected") {
    throw new Error("--decision must be approved or rejected");
  }
  const decidedBy = requiredFlag(flags, "by");
  const engine = new DecisionEngine({
    store: new FileRunStore(resolve(root)),
    provider: dormantProvider(),
  });
  const dossier = await engine.approve(runId, {
    decision,
    decidedBy,
    notes: typeof flags.notes === "string" ? flags.notes : "",
    decidedAt: new Date().toISOString(),
  });
  await writeMarkdownDossier(root, runId, renderDossierMarkdown(dossier));
  process.stdout.write(`${JSON.stringify(dossier.approval, null, 2)}\n`);
}

async function benchmarkCommand(flags: Flags): Promise<void> {
  const seed = typeof flags.seed === "string" ? Number(flags.seed) : undefined;
  const report = runSyntheticBenchmark(seed === undefined ? undefined : { seed });
  const markdown = renderBenchmarkMarkdown(report);
  if (typeof flags.out === "string") {
    await mkdir(dirname(resolve(flags.out)), { recursive: true });
    await writeFile(resolve(flags.out), flags.json ? `${JSON.stringify(report, null, 2)}\n` : markdown, "utf8");
  }
  process.stdout.write(flags.json ? `${JSON.stringify(report, null, 2)}\n` : markdown);
}

async function benchmarkCompareCommand(positional: string[], flags: Flags): Promise<void> {
  const suitePath = positional[0];
  if (!suitePath) throw new Error("benchmark-compare requires an observation-suite JSON path");
  const report = runPairedBenchmark(await readJson(suitePath));
  const output = flags.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : renderPairedBenchmarkMarkdown(report);
  if (typeof flags.out === "string") {
    await mkdir(dirname(resolve(flags.out)), { recursive: true });
    await writeFile(resolve(flags.out), output, "utf8");
  }
  process.stdout.write(output);
}

async function benchmarkBaselineCommand(positional: string[], flags: Flags): Promise<void> {
  const requestPath = positional[0];
  if (!requestPath) throw new Error("benchmark-baseline requires a request JSON path");
  const providerPath = requiredFlag(flags, "provider");
  const arm = requiredFlag(flags, "arm");
  if (arm !== "one_shot" && arm !== "sequential_grill") {
    throw new Error("--arm must be one_shot or sequential_grill");
  }
  const rounds = typeof flags.rounds === "string"
    ? Number(flags.rounds)
    : arm === "one_shot" ? 1 : 3;
  const request = DecisionRequestSchema.parse(await readJson(requestPath));
  const provider = await loadProvider(providerPath);
  const result = await runBaselineSeries({
    provider,
    request,
    arm: arm as BaselineArm,
    rounds,
    maxAttemptsPerCall: 2,
    callIdPrefix: `benchmark.${request.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${arm}`,
  });
  const output = `${JSON.stringify({
    arm: result.arm,
    rounds: result.rounds,
    calls: result.calls,
    usage: result.usage,
    decision: result.decision,
  }, null, 2)}\n`;
  if (typeof flags.out === "string") {
    await mkdir(dirname(resolve(flags.out)), { recursive: true });
    await writeFile(resolve(flags.out), output, "utf8");
  }
  process.stdout.write(output);
}

async function viewCommand(flags: Flags): Promise<void> {
  const runsDirectory = typeof flags.runs === "string"
    ? flags.runs
    : typeof flags.out === "string"
      ? flags.out
      : "runs";
  const port = typeof flags.port === "string" ? Number(flags.port) : 4173;
  const viewer = await startViewerServer({
    runsDirectory: resolve(runsDirectory),
    port,
  });
  process.stdout.write(`Decision viewer: ${viewer.url}\nRuns: ${resolve(runsDirectory)}\n`);

  await new Promise<void>((resolveStop) => {
    let stopping = false;
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      void viewer.close().finally(resolveStop);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

function usage(): string {
  return `Decision Deliberation Public Preview

Commands:
  deliberate --version
  deliberate run <request.json> --config <config.json> --provider <provider.json> [--out runs] [--run-id id]
  deliberate replay --run-id <id> [--out runs]
  deliberate status --run-id <id> [--out runs]
  deliberate approve --run-id <id> --decision approved|rejected --by <name> [--notes text] [--out runs]
  deliberate benchmark [--seed n] [--json] [--out report.md]
  deliberate benchmark-baseline <request.json> --provider <provider.json> --arm one_shot|sequential_grill [--rounds n] [--out result.json]
  deliberate benchmark-compare <observations.json> [--json] [--out report.md]
  deliberate view [--runs runs] [--port 4173]
`;
}

async function main(): Promise<void> {
  const { command, positional, flags } = parseArguments(process.argv.slice(2));
  switch (command) {
    case "run":
      return runCommand(positional, flags);
    case "replay":
      return replayCommand(flags);
    case "status":
      return statusCommand(flags);
    case "approve":
      return approveCommand(flags);
    case "benchmark":
      return benchmarkCommand(flags);
    case "benchmark-baseline":
      return benchmarkBaselineCommand(positional, flags);
    case "benchmark-compare":
      return benchmarkCompareCommand(positional, flags);
    case "view":
      return viewCommand(flags);
    case "version":
    case "--version":
    case "-v":
      process.stdout.write(`${VERSION}\n`);
      return;
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(usage());
      return;
    default:
      throw new Error(`unknown command: ${command}\n\n${usage()}`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
