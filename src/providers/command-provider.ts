import { spawn } from "node:child_process";
import type { SpawnOptionsWithoutStdio } from "node:child_process";

import type {
  AgentProvider,
  AgentRawResponse,
  AgentRequest,
  AgentUsage,
} from "../agents/provider.js";

export interface CommandProviderOptions {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

function decodeResponse(stdout: string): AgentRawResponse {
  let value: unknown;
  try {
    value = JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error(`command returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof value !== "object" || value === null || !("text" in value) || typeof value.text !== "string") {
    throw new Error("command response must be a JSON object containing a string text field");
  }
  const record = value as { text: string; usage?: AgentUsage; metadata?: Record<string, unknown> };
  return {
    text: record.text,
    ...(record.usage === undefined ? {} : { usage: record.usage }),
    ...(record.metadata === undefined ? {} : { metadata: record.metadata }),
  };
}

/** JSON-over-stdio integration seam. It never invokes a shell. */
export class CommandProvider implements AgentProvider {
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(private readonly options: CommandProviderOptions) {
    if (options.command.trim().length === 0) throw new Error("command must not be empty");
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxOutputBytes = options.maxOutputBytes ?? 10 * 1024 * 1024;
  }

  invoke(request: AgentRequest): Promise<AgentRawResponse> {
    return new Promise((resolve, reject) => {
      const spawnOptions: SpawnOptionsWithoutStdio = {
        shell: false as const,
        ...(this.options.cwd === undefined ? {} : { cwd: this.options.cwd }),
        ...(this.options.env === undefined ? {} : { env: this.options.env }),
      };
      const child = spawn(this.options.command, [...(this.options.args ?? [])], spawnOptions);
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let terminalError: Error | undefined;

      const timer = setTimeout(() => {
        terminalError = new Error(`command timed out after ${this.timeoutMs}ms`);
        child.kill("SIGKILL");
      }, this.timeoutMs);
      timer.unref();

      const collect = (target: Buffer[]) => (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        outputBytes += buffer.length;
        if (outputBytes > this.maxOutputBytes) {
          terminalError = new Error(`command output exceeded ${this.maxOutputBytes} bytes`);
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
        if (code !== 0) {
          const detail = Buffer.concat(stderr).toString("utf8").trim();
          return reject(
            new Error(`command exited with ${code ?? `signal ${signal ?? "unknown"}`}${detail ? `: ${detail}` : ""}`),
          );
        }
        try {
          resolve(decodeResponse(Buffer.concat(stdout).toString("utf8").trim()));
        } catch (error) {
          reject(error);
        }
      });

      child.stdin.end(`${JSON.stringify(request)}\n`);
    });
  }
}
