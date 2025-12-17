import typescript from "@rollup/plugin-typescript";
import {mkdir, rm} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {rollup} from "rollup";

const dir = dirname(fileURLToPath(import.meta.url));
const dist = resolve(dir, "dist");

try {
  await rm(dist, { recursive: true });
} catch {}
await mkdir(dist);

{
  const res = await rollup({
    input: "lib/mod.ts",
    external: [
      "mithril",
      "@longform/longform",
      "jsonld",
      "json-ptr",
      "uri-templates",
      "@occultist/occultist",
    ],
    plugins: [typescript()],
  });
  await res.write({
    file: "dist/occultist-extensions.js",
    format: "es",
    sourcemap: true,
  });
  await res.write({
    file: "dist/occultist-extensions.cjs",
    format: "cjs",
    sourcemap: true,
  });
}
