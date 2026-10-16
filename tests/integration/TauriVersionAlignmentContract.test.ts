import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

type PackageLock = {
  packages?: Record<string, { version?: string }>;
};

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function majorMinor(version: string): string {
  const match = version.match(/^(\d+\.\d+)\./);
  if (!match) {
    throw new Error(`Unsupported semver version: ${version}`);
  }
  return match[1];
}

function readRustTauriVersion(): string {
  const cargoLock = fs.readFileSync(
    path.resolve(process.cwd(), "src-tauri/Cargo.lock"),
    "utf8",
  );
  const match = cargoLock.match(
    /\[\[package\]\]\s+name = "tauri"\s+version = "([^"]+)"/m,
  );
  if (!match) {
    throw new Error("Could not find tauri package in src-tauri/Cargo.lock");
  }
  return match[1];
}

function readRustTauriManifestVersion(): string {
  const cargoToml = fs.readFileSync(
    path.resolve(process.cwd(), "src-tauri/Cargo.toml"),
    "utf8",
  );
  const match = cargoToml.match(
    /^tauri\s*=\s*\{[^}]*\bversion\s*=\s*"([^"]+)"/m,
  );
  if (!match) {
    throw new Error("Could not find tauri dependency in src-tauri/Cargo.toml");
  }
  return match[1];
}

function readLockedNpmVersion(packageName: string): string {
  const packageLock = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), "package-lock.json"), "utf8"),
  ) as PackageLock;
  const version = packageLock.packages?.[`node_modules/${packageName}`]?.version;
  if (!version) {
    throw new Error(`Could not find locked npm package ${packageName}`);
  }
  return version;
}

function readManifestNpmVersion(packageName: string): string {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
  ) as PackageJson;
  const version =
    packageJson.dependencies?.[packageName] ??
    packageJson.devDependencies?.[packageName];
  if (!version) {
    throw new Error(`Could not find npm package ${packageName} in package.json`);
  }
  return version;
}

describe("Tauri package version alignment", () => {
  it("keeps npm Tauri packages on the same major/minor as the Rust Tauri crate", () => {
    const rustTauri = readRustTauriVersion();
    const rustMajorMinor = majorMinor(rustTauri);

    expect(majorMinor(readLockedNpmVersion("@tauri-apps/api"))).toBe(
      rustMajorMinor,
    );
    expect(majorMinor(readLockedNpmVersion("@tauri-apps/cli"))).toBe(
      rustMajorMinor,
    );
  });

  it("pins Tauri manifests so non-locked release builds cannot silently drift", () => {
    const rustTauri = readRustTauriVersion();

    expect(readRustTauriManifestVersion()).toBe(`=${rustTauri}`);
    for (const packageName of ["@tauri-apps/api", "@tauri-apps/cli"]) {
      expect(readManifestNpmVersion(packageName)).toBe(
        readLockedNpmVersion(packageName),
      );
      expect(readManifestNpmVersion(packageName)).not.toMatch(/^[~^*]/);
    }
  });
});
