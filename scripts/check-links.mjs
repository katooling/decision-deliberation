import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignored = new Set([".git", "dist", "node_modules", "outputs", "release", "runs", "work"]);

async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    const projectPath = relative(root, absolute).replaceAll("\\", "/");
    const first = projectPath.split("/", 1)[0];
    if (entry.isDirectory() && !ignored.has(first)) files.push(...await markdownFiles(absolute));
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(absolute);
  }
  return files;
}

const failures = [];
let checked = 0;
for (const file of await markdownFiles(root)) {
  const content = await readFile(file, "utf8");
  const pattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const raw = match[1]?.trim().replace(/^<|>$/g, "");
    if (!raw || /^(?:https?:|mailto:|#)/i.test(raw)) continue;
    const path = decodeURIComponent(raw.split("#", 1)[0] ?? "");
    if (!path) continue;
    checked += 1;
    try {
      await access(resolve(dirname(file), path));
    } catch {
      const line = content.slice(0, match.index).split("\n").length;
      failures.push(`${relative(root, file)}:${line}: ${raw}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Local Markdown link check failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Local Markdown link check passed: ${checked} links checked.`);
}
