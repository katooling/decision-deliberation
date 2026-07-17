import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AgentRequest } from "../src/agents/provider.js";
import { CodexCliProvider } from "../src/providers/codex-cli-provider.js";

const proposal = {
  schemaVersion: 1,
  resolution: {
    type: "conclude",
    conclusion: {
      summary: "The branch is resolved.",
      recommendation: "Keep the current path.",
      conditions: ["The supplied context remains accurate."],
      caveats: ["This is a provider conformance fixture."],
      unresolvedQuestions: [],
    },
  },
};

const baselineDecision = {
  schemaVersion: 1,
  recommendation: "Use the smallest reversible migration slice.",
  reasoning: ["It provides evidence before committing the full dataset."],
  rankedAlternatives: [
    {
      label: "Full migration",
      rationale: "Faster only if every mapping assumption is already correct.",
    },
  ],
  assumptions: ["A representative slice can be selected."],
  uncertainties: ["The final backlink conversion rate is not measured yet."],
};

const request: AgentRequest = {
  callId: "call_provider_conformance",
  role: "question-proposer",
  input: { branch: { path: [] }, optionBounds: { min: 2, target: 3, max: 4 } },
  contract: "Return QuestionProposalSchema v1.",
  attempt: 1,
  validationErrors: [],
};

async function fakeCodex(directory: string): Promise<string> {
  const path = join(directory, "fake-codex.mjs");
  await writeFile(
    path,
    `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const required = ["exec", "--ephemeral", "--json", "--sandbox", "read-only", "--skip-git-repo-check", "--ignore-user-config", "--output-schema"];
for (const value of required) {
  if (!args.includes(value)) {
    process.stderr.write("missing required argument: " + value);
    process.exit(21);
  }
}
const schemaPath = args[args.indexOf("--output-schema") + 1];
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
if (schema.properties?.schemaVersion?.const !== 1 || (!schema.properties?.resolution && !schema.properties?.recommendation)) {
  process.stderr.write("unexpected output schema");
  process.exit(22);
}
if (JSON.stringify(schema).includes('"oneOf"')) {
  process.stderr.write("oneOf is not supported by Codex structured outputs");
  process.exit(24);
}
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
if (!prompt.includes("question-proposer") && !prompt.includes("baseline-designer")) {
  process.stderr.write("request context missing from prompt");
  process.exit(23);
}
writeFileSync(${JSON.stringify(join(directory, "observed-cwd.txt"))}, process.cwd());
const response = schema.properties?.resolution
  ? ${JSON.stringify(JSON.stringify(proposal))}
  : ${JSON.stringify(JSON.stringify(baselineDecision))};
const events = [
  { type: "thread.started", thread_id: "thread_fixture" },
  { type: "turn.started" },
  { type: "item.completed", item: { id: "item_1", type: "agent_message", text: response } },
  { type: "turn.completed", usage: { input_tokens: 120, cached_input_tokens: 20, output_tokens: 45, reasoning_output_tokens: 5 } }
];
for (const event of events) process.stdout.write(JSON.stringify(event) + "\\n");
`,
    "utf8",
  );
  await chmod(path, 0o755);
  return path;
}

test("Codex CLI provider isolates the run and returns structured output with usage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "decision-deliberation-codex-test-"));
  try {
    const codexBin = await fakeCodex(directory);
    const provider = new CodexCliProvider({ codexBin, timeoutMs: 5_000 });

    const response = await provider.invoke(request);

    assert.deepEqual(JSON.parse(response.text), proposal);
    assert.deepEqual(response.usage, {
      inputTokens: 120,
      outputTokens: 45,
      latencyMs: response.usage?.latencyMs,
    });
    assert.ok((response.usage?.latencyMs ?? -1) >= 0);
    assert.deepEqual(response.metadata, {
      provider: "codex-cli",
      threadId: "thread_fixture",
      cachedInputTokens: 20,
      reasoningOutputTokens: 5,
    });

    const observedCwd = await readFile(join(directory, "observed-cwd.txt"), "utf8");
    assert.notEqual(observedCwd, process.cwd());
    assert.match(observedCwd, /decision-deliberation-codex-/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Codex CLI provider supports the benchmark baseline role", async () => {
  const directory = await mkdtemp(join(tmpdir(), "decision-deliberation-codex-test-"));
  try {
    const codexBin = await fakeCodex(directory);
    const provider = new CodexCliProvider({ codexBin, timeoutMs: 5_000 });
    const response = await provider.invoke({
      ...request,
      callId: "call_baseline",
      role: "baseline-designer",
      contract: "Return BaselineDecisionSchema v1.",
    });
    assert.deepEqual(JSON.parse(response.text), baselineDecision);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Codex CLI provider preserves the decisive tail of stderr", async () => {
  const directory = await mkdtemp(join(tmpdir(), "decision-deliberation-codex-test-"));
  try {
    const codexBin = join(directory, "failing-codex.mjs");
    await writeFile(
      codexBin,
      `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("end", () => {
  process.stderr.write("warning\\n".repeat(1_000));
  process.stderr.write("FINAL_CAUSE: unsupported schema keyword\\n");
  process.exit(1);
});
`,
      "utf8",
    );
    await chmod(codexBin, 0o755);
    const provider = new CodexCliProvider({ codexBin, timeoutMs: 5_000 });
    await assert.rejects(provider.invoke(request), /FINAL_CAUSE: unsupported schema keyword/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Codex CLI provider includes structured stdout errors from failed runs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "decision-deliberation-codex-test-"));
  try {
    const codexBin = join(directory, "failing-codex.mjs");
    await writeFile(
      codexBin,
      `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({ type: "error", message: "SCHEMA_CAUSE: invalid output schema" }) + "\\n");
  process.stderr.write("warning\\n".repeat(1_000));
  process.exit(1);
});
`,
      "utf8",
    );
    await chmod(codexBin, 0o755);
    const provider = new CodexCliProvider({ codexBin, timeoutMs: 5_000 });
    await assert.rejects(provider.invoke(request), /SCHEMA_CAUSE: invalid output schema/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
