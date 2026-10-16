import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Reads the facade and only the lexical owners it actually compiles. */
export const readLongCaptureRustSources = (): string => {
  const entryPath = resolve(process.cwd(), "src-tauri/src/long_capture.rs");
  const entrySource = readFileSync(entryPath, "utf8");
  const owners = [...entrySource.matchAll(/include!\("([^"]+)"\);/g)].map((match) =>
    readFileSync(resolve(dirname(entryPath), match[1]), "utf8"),
  );
  return [entrySource, ...owners].join("\n");
};
