import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const legacyProductToken = ["art", "hook"].join("");

const collectFiles = (root: string): string[] => {
  const output: string[] = [];
  const visit = (path: string) => {
    if (!existsSync(path)) return;
    const stat = statSync(path);
    if (stat.isDirectory()) {
      const name = path.split(/[\\/]/).pop() || "";
      if (["node_modules", "target", ".runtime", ".vinxi", ".output", "dist"].includes(name)) {
        return;
      }
      for (const child of readdirSync(path)) {
        visit(join(path, child));
      }
      return;
    }
    output.push(path);
  };
  visit(root);
  return output;
};

const currentProductFiles = () => {
  const hookRoot = process.cwd();
  const files = [
    ...readdirSync(hookRoot)
      .filter((name) => name.endsWith(".md"))
      .map((name) => resolve(hookRoot, name)),
    "package.json",
    "package-lock.json",
    "launch-config.cmd",
    "build-hook-release.bat",
    "package-hook-release.ps1",
    "start-hook.bat",
    "stop-hook.bat",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "src-tauri/tauri.conf.json",
  ].map((path) => resolve(hookRoot, path));

  files.push(...collectFiles(resolve(hookRoot, "src")));
  files.push(...collectFiles(resolve(hookRoot, "src-tauri", "src")));
  files.push(...collectFiles(resolve(hookRoot, "src-tauri", "tests")));
  files.push(...collectFiles(resolve(hookRoot, "scripts")));

  return files.filter((path, index, all) => existsSync(path) && all.indexOf(path) === index);
};

describe("Hook product naming contract", () => {
  it("uses hook.exe, hook package names, HOOK_* environment variables, and hook runtime names", () => {
    const hookRoot = process.cwd();
    const legacyFileStem = ["art", "hook"].join("-");

    for (const oldName of [
      `build-${legacyFileStem}-release.bat`,
      `package-${legacyFileStem}-release.ps1`,
      `start-${legacyFileStem}.bat`,
      `start-${legacyFileStem}-capture-test.bat`,
      `stop-${legacyFileStem}.bat`,
      `verify-${legacyFileStem}-full.bat`,
    ]) {
      expect(existsSync(resolve(hookRoot, oldName)), `${oldName} should be renamed`).toBe(false);
    }

    const forbidden = new RegExp(legacyProductToken, "i");
    const offenders = currentProductFiles()
      .map((path) => {
        const content = readFileSync(path, "utf8");
        return forbidden.test(content) ? relative(hookRoot, path) : null;
      })
      .filter((path): path is string => Boolean(path));

    expect(offenders).toEqual([]);
  });
});
