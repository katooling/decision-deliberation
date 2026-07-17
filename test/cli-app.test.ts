import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("app CLI starts the product experience on loopback without exposing advanced controls", async () => {
  const directory = await mkdtemp(join(tmpdir(), "decision-product-cli-"));
  const providerPath = join(directory, "provider.json");
  await writeFile(providerPath, `${JSON.stringify({ type: "scripted", responses: [] })}\n`, "utf8");
  const child = spawn(process.execPath, [
    "--import",
    "tsx",
    resolve("src/cli.ts"),
    "app",
    "--provider",
    providerPath,
    "--runs",
    join(directory, "runs"),
    "--port",
    "0",
  ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });

  try {
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });

    const url = await new Promise<string>((resolveUrl, reject) => {
      const timeout = setTimeout(() => reject(new Error(`app did not start: ${stdout}\n${stderr}`)), 5_000);
      const inspect = (): void => {
        const match = stdout.match(/Decision app: (http:\/\/127\.0\.0\.1:\d+)/);
        if (match?.[1] !== undefined) {
          clearTimeout(timeout);
          resolveUrl(match[1]);
        }
      };
      child.stdout.on("data", inspect);
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`app exited before startup with ${code}: ${stderr}`));
      });
    });

    const response = await fetch(url);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /What are you deciding/);
    assert.doesNotMatch(html, /BFS|DFS|bootstrap|agent count/i);

    child.kill("SIGTERM");
    const exitCode = await new Promise<number | null>((resolveExit) => child.once("exit", resolveExit));
    assert.equal(exitCode, 0);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});
