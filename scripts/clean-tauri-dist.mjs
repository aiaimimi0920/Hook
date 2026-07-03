import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const toDisplayPath = (root, path) => relative(root, path).split(sep).join("/");

const removeFile = (root, path, removedFiles) => {
  if (!existsSync(path)) return;
  rmSync(path, { force: true });
  removedFiles.push(toDisplayPath(root, path));
};

const walkFiles = (root, dir, visit) => {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walkFiles(root, path, visit);
    } else if (stat.isFile()) {
      visit(path);
    }
  }
};

export const cleanTauriDist = (publicDir = resolve(".output", "public")) => {
  const root = resolve(publicDir);
  const removedFiles = [];
  const removedDirectories = [];

  if (!existsSync(root)) {
    throw new Error(`Tauri frontendDist not found: ${root}`);
  }

  walkFiles(root, root, (path) => {
    if (path.endsWith(".gz") || path.endsWith(".br")) {
      removeFile(root, path, removedFiles);
    }
  });

  return { removedFiles, removedDirectories };
};

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const publicDir = process.argv[2] ? resolve(process.argv[2]) : resolve(".output", "public");
  const result = cleanTauriDist(publicDir);
  console.log(
    `[Hook build] Cleaned Tauri frontendDist: ${result.removedFiles.length} files, ${result.removedDirectories.length} directories removed.`,
  );
}
