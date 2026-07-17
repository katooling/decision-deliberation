import type {
  AgentProvider,
  AgentRawResponse,
  AgentRequest,
} from "../agents/provider.js";

export type ScriptedResponse = string | AgentRawResponse | Error;
export type ScriptedResolver = (
  request: AgentRequest,
) => ScriptedResponse | Promise<ScriptedResponse>;
export type ScriptedProviderScript =
  | readonly ScriptedResponse[]
  | Readonly<Record<string, ScriptedResponse | readonly ScriptedResponse[]>>
  | ScriptedResolver;

function normalize(response: ScriptedResponse): AgentRawResponse {
  if (response instanceof Error) throw response;
  return typeof response === "string" ? { text: response } : response;
}

/** Deterministic provider used by replay, tests, demos, and benchmarks. */
export class ScriptedProvider implements AgentProvider {
  readonly calls: AgentRequest[] = [];
  private readonly indexes = new Map<string, number>();
  private globalIndex = 0;

  constructor(private readonly script: ScriptedProviderScript) {}

  async invoke(request: AgentRequest): Promise<AgentRawResponse> {
    this.calls.push(structuredClone(request));
    if (typeof this.script === "function") return normalize(await this.script(request));

    if (Array.isArray(this.script)) {
      const response = this.script[this.globalIndex];
      this.globalIndex += 1;
      if (response === undefined) throw new Error(`no scripted response for call ${request.callId}`);
      return normalize(response);
    }

    const keyedScript = this.script as Readonly<
      Record<string, ScriptedResponse | readonly ScriptedResponse[]>
    >;
    const keys = [
      `${request.callId}:${request.attempt}`,
      request.callId,
      `${request.role}:${request.attempt}`,
      request.role,
      "*",
    ];
    const key = keys.find((candidate) => keyedScript[candidate] !== undefined);
    if (key === undefined) throw new Error(`no scripted response for call ${request.callId}`);

    const entry = keyedScript[key];
    if (!Array.isArray(entry)) return normalize(entry as ScriptedResponse);
    const index = this.indexes.get(key) ?? 0;
    const response = entry[index];
    this.indexes.set(key, index + 1);
    if (response === undefined) throw new Error(`scripted responses exhausted for key ${key}`);
    return normalize(response);
  }
}
