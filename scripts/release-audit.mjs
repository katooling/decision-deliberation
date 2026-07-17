import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignoredRoots = new Set([
  ".git",
  "coverage",
  "dist",
  "node_modules",
  "outputs",
  "release",
  "runs",
  "work",
]);

const forbiddenNames = [
  /^\.env(?:\..+)?$/,
  /^\.npmrc$/,
  /(?:^|\/)(?:id_rsa|id_ed25519)$/,
  /\.(?:key|p12|pfx|pem)$/i,
];

const forbiddenContent = [
  ["macOS user path", /\/Users\/[^/\s]+/g],
  ["Unix user path", /\/home\/[^/\s]+/g],
  ["macOS private temporary path", /\/private\/(?:tmp|var)\//g],
  ["Windows user path", /[A-Za-z]:\\Users\\[^\\\s]+/g],
  ["private work email", /[A-Z0-9._%+-]+@agoda\.com/gi],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g],
  ["OpenAI-compatible key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ["bearer credential", /Authorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi],
];

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const absolute = join(directory, entry.name);
    const projectPath = relative(root, absolute).replaceAll("\\", "/");
    const first = projectPath.split("/", 1)[0];
    if (entry.isDirectory()) {
      if (!ignoredRoots.has(first)) files.push(...await walk(absolute));
    } else if (entry.isFile()) {
      files.push(projectPath);
    }
  }
  return files;
}

function trackedFiles() {
  try {
    const output = execFileSync("git", ["-C", root, "ls-files", "-z"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const files = output.split("\0").filter(Boolean);
    return files.length > 0 ? files : null;
  } catch {
    return null;
  }
}

const files = trackedFiles() ?? await walk(root);
const findings = [];
let scannedTextFiles = 0;

for (const projectPath of files.sort()) {
  const normalized = projectPath.replaceAll("\\", "/");
  const name = normalized.split("/").at(-1) ?? normalized;
  if (forbiddenNames.some((pattern) => pattern.test(name)) && name !== ".env.example") {
    findings.push(`${normalized}: forbidden sensitive filename`);
    continue;
  }

  const bytes = await readFile(join(root, normalized));
  if (bytes.includes(0)) continue;
  const content = bytes.toString("utf8");
  scannedTextFiles += 1;
  for (const [label, pattern] of forbiddenContent) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const line = content.slice(0, match.index).split("\n").length;
      findings.push(`${normalized}:${line}: ${label}`);
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
  }
}

if (findings.length > 0) {
  console.error("Release audit failed:\n");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Release audit passed: ${files.length} files considered, ${scannedTextFiles} text files scanned.`);
}
