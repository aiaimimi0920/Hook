import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const readCompiledRustSource = (entryPath: string, visited: Set<string>): string[] => {
  const absolutePath = resolve(entryPath);
  if (visited.has(absolutePath)) return [];
  visited.add(absolutePath);

  const source = readFileSync(absolutePath, "utf8");
  const owners = [...source.matchAll(/include!\("([^"]+)"\);/g)].flatMap((match) =>
    readCompiledRustSource(resolve(dirname(absolutePath), match[1]), visited),
  );
  return [source, ...owners];
};

/** Reads lib.rs and only the lexical owners reachable from its compiled include graph. */
export const readHookLibRustSources = (): string =>
  readCompiledRustSource(
    resolve(process.cwd(), "src-tauri/src/lib.rs"),
    new Set<string>(),
  ).join("\n");
