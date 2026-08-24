import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Reads the facade and only the responsibility owners it compiles. */
export const readLoomHookRustSources = (): string => {
  const entryPath = resolve(process.cwd(), "src-tauri/src/loom_hook.rs");
  const entrySource = readFileSync(entryPath, "utf8");
  const owners = [...entrySource.matchAll(/include!\("([^"]+)"\);/g)].map((match) =>
    readFileSync(resolve(dirname(entryPath), match[1]), "utf8"),
  );
  return [entrySource, ...owners].join("\n");
};
