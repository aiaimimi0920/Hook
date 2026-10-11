import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const otterRoot = process.cwd();

function cargoPackageVersion(source: string): string {
  const match = source.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error("Missing Cargo package version");
  return match[1];
}

function cargoLockOtterVersion(source: string): string {
  const match = source.match(/\[\[package\]\]\s+name\s*=\s*"otter"\s+version\s*=\s*"([^"]+)"/s);
  if (!match) throw new Error("Missing Otter package in Cargo.lock");
  return match[1];
}

describe("Otter release version contract", () => {
  it("keeps every public product version field aligned", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(otterRoot, "package.json"), "utf8"),
    ) as { version: string };
    const packageLock = JSON.parse(
      readFileSync(resolve(otterRoot, "package-lock.json"), "utf8"),
    ) as { version: string; packages: Record<string, { version: string }> };
    const tauriConfig = JSON.parse(
      readFileSync(resolve(otterRoot, "src-tauri/tauri.conf.json"), "utf8"),
    ) as { version: string };
    const cargoToml = readFileSync(resolve(otterRoot, "src-tauri/Cargo.toml"), "utf8");
    const cargoLock = readFileSync(resolve(otterRoot, "src-tauri/Cargo.lock"), "utf8");

    const versions = [
      packageJson.version,
      packageLock.version,
      packageLock.packages[""].version,
      tauriConfig.version,
      cargoPackageVersion(cargoToml),
      cargoLockOtterVersion(cargoLock),
    ];

    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(new Set(versions)).toEqual(new Set([packageJson.version]));
  });
});
