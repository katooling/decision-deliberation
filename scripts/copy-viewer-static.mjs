import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve("src/viewer/static");
const destination = resolve("dist/src/viewer/static");

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true, force: true });
