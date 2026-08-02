import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const hookRoot = process.cwd();

function cargoPackageVersion(source: string): string {
  const match = source.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error("Missing Cargo package version");
  return match[1];
}

function cargoLockHookVersion(source: string): string {
  const match = source.match(/\[\[package\]\]\s+name\s*=\s*"hook"\s+version\s*=\s*"([^"]+)"/s);
  if (!match) throw new Error("Missing Hook package in Cargo.lock");
  return match[1];
}

describe("Hook release version contract", () => {
  it("keeps every public product version field aligned", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(hookRoot, "package.json"), "utf8"),
    ) as { version: string };
    const packageLock = JSON.parse(
      readFileSync(resolve(hookRoot, "package-lock.json"), "utf8"),
    ) as { version: string; packages: Record<string, { version: string }> };
    const tauriConfig = JSON.parse(
      readFileSync(resolve(hookRoot, "src-tauri/tauri.conf.json"), "utf8"),
    ) as { version: string };
    const cargoToml = readFileSync(resolve(hookRoot, "src-tauri/Cargo.toml"), "utf8");
    const cargoLock = readFileSync(resolve(hookRoot, "src-tauri/Cargo.lock"), "utf8");

    const versions = [
      packageJson.version,
      packageLock.version,
      packageLock.packages[""].version,
      tauriConfig.version,
      cargoPackageVersion(cargoToml),
      cargoLockHookVersion(cargoLock),
    ];

    expect(new Set(versions)).toEqual(new Set(["0.1.6"]));
  });
});
