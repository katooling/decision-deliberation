import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const directories = ["viewer", "product"];

for (const directory of directories) {
  const source = resolve(`src/${directory}/static`);
  const destination = resolve(`dist/src/${directory}/static`);
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
}
