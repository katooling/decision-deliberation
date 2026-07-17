import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentProvider,
  AgentRawResponse,
  AgentRequest,
  AgentUsage,
} from "../agents/provider.js";
import {
  decodeCodexStructuredText,
  outputSchemaForRequest,
  schemaForRequest,
} from "./codex-cli-codec.js";

export interface CodexCliProviderOptions {
  codexBin?: string;
  model?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

interface CodexUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
}

interface ParsedCodexEvents {
  message: string;
  threadId?: string;
  usage?: CodexUsage;
}

const CODEX_USAGE_FIELDS = [
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
] as const;

function parseCodexUsage(value: unknown): CodexUsage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("codex turn.completed usage must be an object");
  }
  const record = value as Record<string, unknown>;
  const usage: CodexUsage = {};
  for (const field of CODEX_USAGE_FIELDS) {
    const count = record[field];
    if (count === undefined) continue;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      throw new Error(`codex turn.completed usage.${field} must be a nonnegative integer`);
    }
    usage[field] = count;
  }
  return usage;
}

const ENVIRONMENT_ALLOWLIST = [
  "PATH", "Path", "HOME", "USER", "LOGNAME", "SHELL",
  "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE",
  "CODEX_HOME", "CODEX_API_KEY",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY",
  "http_proxy", "https_proxy", "no_proxy", "all_proxy",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
] as const;

function codexEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    ENVIRONMENT_ALLOWLIST.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]]]),
  );
}

function redactSensitiveText(text: string, environment: NodeJS.ProcessEnv): string {
  let redacted = text;
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined || value.length < 4) continue;
    if (/key|token|secret|password/i.test(key) || /_proxy$/i.test(key)) {
      redacted = redacted.split(value).join("[REDACTED]");
    }
  }
  return redacted
    .replace(/\b(?:sk|sess)-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/(["']?(?:access_token|refresh_token|api_key|password)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[REDACTED]");
}

function buildPrompt(request: AgentRequest): string {
  return [
    "You are a bounded role inside Decision Deliberation.",
    "Work only from the supplied JSON. Do not run tools, inspect files, or use the network.",
    "Return only the JSON document required by the output schema.",
    "Do not wrap the response in Markdown or XML.",
    "",
    JSON.stringify({
      callId: request.callId,
      role: request.role,
      contract: request.contract,
      attempt: request.attempt,
      validationErrors: request.validationErrors,
      input: request.input,
    }, null, 2),
  ].join("\n");
}

function parseEventStream(stdout: string): ParsedCodexEvents {
  let message: string | undefined;
  let threadId: string | undefined;
  let usage: CodexUsage | undefined;

  for (const [index, line] of stdout.split("\n").entries()) {
    if (line.trim().length === 0) continue;
    let event: unknown;
    try {
      event = JSON.parse(line) as unknown;
    } catch (error) {
      throw new Error(
        `codex returned invalid JSONL at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (typeof event !== "object" || event === null || !("type" in event)) continue;
    const record = event as Record<string, unknown>;
    if (record.type === "thread.started" && typeof record.thread_id === "string") {
      threadId = record.thread_id;
    }
    if (record.type === "item.completed" && typeof record.item === "object" && record.item !== null) {
      const item = record.item as Record<string, unknown>;
      if (item.type === "agent_message" && typeof item.text === "string") message = item.text;
    }
    if (record.type === "turn.completed" && record.usage !== undefined) {
      usage = parseCodexUsage(record.usage);
    }
    if (record.type === "turn.failed" || record.type === "error") {
      const detail = typeof record.message === "string" ? `: ${record.message}` : "";
      throw new Error(`codex event stream reported ${String(record.type)}${detail}`);
    }
  }

  if (message === undefined) throw new Error("codex event stream did not contain a final agent message");
  return {
    message,
    ...(threadId === undefined ? {} : { threadId }),
    ...(usage === undefined ? {} : { usage }),
  };
}

function collectProcess(
  child: ChildProcessWithoutNullStreams,
  stdin: string,
  timeoutMs: number,
  maxOutputBytes: number,
  environment: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let terminalError: Error | undefined;

    const timer = setTimeout(() => {
      terminalError = new Error(`codex timed out after ${timeoutMs}ms`);
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref();

    const collect = (target: Buffer[]) => (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += buffer.length;
      if (outputBytes > maxOutputBytes) {
        terminalError = new Error(`codex output exceeded ${maxOutputBytes} bytes`);
        child.kill("SIGKILL");
        return;
      }
      target.push(buffer);
    };

    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", (error) => {
      terminalError = error;
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (terminalError !== undefined) return reject(terminalError);
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) {
        const stdoutDetail = redactSensitiveText(stdoutText.trim().slice(-4_000), environment);
        const stderrDetail = redactSensitiveText(stderrText.trim().slice(-4_000), environment);
        const detail = [
          ...(stdoutDetail.length === 0 ? [] : [`stdout: ${stdoutDetail}`]),
          ...(stderrDetail.length === 0 ? [] : [`stderr: ${stderrDetail}`]),
        ].join("\n");
        return reject(
          new Error(`codex exited with ${code ?? `signal ${signal ?? "unknown"}`}${detail ? `: ${detail}` : ""}`),
        );
      }
      resolve({ stdout: stdoutText, stderr: stderrText });
    });
    child.stdin.end(stdin);
  });
}

/** Isolated `codex exec` adapter for the existing AgentProvider seam. */
export class CodexCliProvider implements AgentProvider {
  private readonly codexBin: string;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(private readonly options: CodexCliProviderOptions = {}) {
    this.codexBin = options.codexBin ?? "codex";
    this.timeoutMs = options.timeoutMs ?? 300_000;
    this.maxOutputBytes = options.maxOutputBytes ?? 10 * 1024 * 1024;
    if (this.codexBin.trim().length === 0) throw new Error("codexBin must not be empty");
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("timeoutMs must be a positive integer");
    }
    if (!Number.isInteger(this.maxOutputBytes) || this.maxOutputBytes <= 0) {
      throw new Error("maxOutputBytes must be a positive integer");
    }
  }

  async invoke(request: AgentRequest): Promise<AgentRawResponse> {
    const schema = schemaForRequest(request);
    const directory = await mkdtemp(join(tmpdir(), "decision-deliberation-codex-"));
    const schemaPath = join(directory, "output-schema.json");
    const startedAt = performance.now();
    try {
      await writeFile(
        schemaPath,
        `${JSON.stringify(outputSchemaForRequest(request, schema), null, 2)}\n`,
        "utf8",
      );
      const args = [
        "exec",
        "--ephemeral",
        "--json",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--ignore-user-config",
        "--output-schema",
        schemaPath,
        ...(this.options.model === undefined ? [] : ["--model", this.options.model]),
        "-",
      ];
      const environment = codexEnvironment(process.env);
      const child = spawn(this.codexBin, args, {
        cwd: directory,
        env: environment,
        shell: false,
      });
      const result = await collectProcess(
        child,
        buildPrompt(request),
        this.timeoutMs,
        this.maxOutputBytes,
        environment,
      );
      let events: ParsedCodexEvents;
      try {
        events = parseEventStream(result.stdout);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(redactSensitiveText(message, environment));
      }
      const latencyMs = Math.round(performance.now() - startedAt);
      const reported = events.usage;
      const usage: AgentUsage = {
        ...(reported?.input_tokens === undefined ? {} : { inputTokens: reported.input_tokens }),
        ...(reported?.output_tokens === undefined ? {} : { outputTokens: reported.output_tokens }),
        latencyMs,
      };
      return {
        text: decodeCodexStructuredText(request, events.message),
        usage,
        metadata: {
          provider: "codex-cli",
          rawProviderText: events.message,
          ...(events.threadId === undefined ? {} : { threadId: events.threadId }),
          ...(reported?.cached_input_tokens === undefined
            ? {}
            : { cachedInputTokens: reported.cached_input_tokens }),
          ...(reported?.reasoning_output_tokens === undefined
            ? {}
            : { reasoningOutputTokens: reported.reasoning_output_tokens }),
        },
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
