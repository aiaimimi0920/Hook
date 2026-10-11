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
  const otterRoot = process.cwd();
  const files = [
    ...readdirSync(otterRoot)
      .filter((name) => name.endsWith(".md"))
      .map((name) => resolve(otterRoot, name)),
    "package.json",
    "package-lock.json",
    "launch-config.cmd",
    "build-otter-release.bat",
    "package-otter-release.ps1",
    "start-otter.bat",
    "stop-otter.bat",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "src-tauri/tauri.conf.json",
  ].map((path) => resolve(otterRoot, path));

  files.push(...collectFiles(resolve(otterRoot, "src")));
  files.push(...collectFiles(resolve(otterRoot, "src-tauri", "src")));
  files.push(...collectFiles(resolve(otterRoot, "src-tauri", "tests")));
  files.push(...collectFiles(resolve(otterRoot, "scripts")));

  return files.filter((path, index, all) => existsSync(path) && all.indexOf(path) === index);
};

describe("Otter product naming contract", () => {
  it("uses otter.exe, hook package names, OTTER_* environment variables, and hook runtime names", () => {
    const otterRoot = process.cwd();
    const legacyFileStem = ["art", "hook"].join("-");

    for (const oldName of [
      `build-${legacyFileStem}-release.bat`,
      `package-${legacyFileStem}-release.ps1`,
      `start-${legacyFileStem}.bat`,
      `start-${legacyFileStem}-capture-test.bat`,
      `stop-${legacyFileStem}.bat`,
      `verify-${legacyFileStem}-full.bat`,
    ]) {
      expect(existsSync(resolve(otterRoot, oldName)), `${oldName} should be renamed`).toBe(false);
    }

    const forbidden = new RegExp(legacyProductToken, "i");
    const offenders = currentProductFiles()
      .map((path) => {
        const content = readFileSync(path, "utf8");
        return forbidden.test(content) ? relative(otterRoot, path) : null;
      })
      .filter((path): path is string => Boolean(path));

    expect(offenders).toEqual([]);
  });
});
