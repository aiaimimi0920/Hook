import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Reads the Loom connector facade together with its explicit module owners. */
export const readLoomConnectorRustSources = (): string => {
  const sourceRoot = resolve(process.cwd(), "src-tauri/src");
  const ownerRoot = join(sourceRoot, "loom_connector");
  const ownerPaths = readdirSync(ownerRoot)
    .filter((fileName) => fileName.endsWith(".rs"))
    .sort()
    .map((fileName) => join(ownerRoot, fileName));

  return [join(sourceRoot, "loom_connector.rs"), ...ownerPaths]
    .map((filePath) => readFileSync(filePath, "utf8"))
    .join("\n");
};
