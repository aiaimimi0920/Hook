import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const helper = resolve("scripts/version-identity.ps1");
const bump = resolve("scripts/bump-internal-version.ps1");
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
function run(command: string): string {
  return execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `$ErrorActionPreference = 'Stop'; Set-StrictMode -Version Latest; ${command}`],
  { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function fixture(action: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "hook-version-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "0.2.30" }));
    writeFileSync(join(root, "version-state.json"), JSON.stringify({ publicVersion: "0.2.30", internalRevision: 0 }));
    action(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("Hook internal version allocation", () => {
  it("increments only the internal revision and leaves public metadata byte-identical", { timeout: 60000 }, () => fixture(root => {
    const before = readFileSync(join(root, "package.json"));
    expect(run(`& ${quote(bump)} -RepoRoot ${quote(root)}`)).toBe("v0.2.30.1");
    expect(run(`& ${quote(bump)} -RepoRoot ${quote(root)}`)).toBe("v0.2.30.2");
    expect(readFileSync(join(root, "package.json"))).toEqual(before);
    const state = readFileSync(join(root, "version-state.json"));
    expect(state.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    expect(JSON.parse(state.toString())).toEqual({ publicVersion: "0.2.30", internalRevision: 2 });
  }));

  it("distinguishes public identity and prevents publishing an internal candidate", { timeout: 60000 }, () => fixture(root => {
    const prefix = `. ${quote(helper)}; $identity = Get-HookVersionIdentity -RepoRoot ${quote(root)}`;
    expect(JSON.parse(run(`${prefix}; $identity | ConvertTo-Json`))).toMatchObject({
      productVersion: "0.2.30", buildVersion: "v0.2.30.0", channel: "internal",
    });
    expect(() => run(`${prefix}; Assert-HookPublicBuildIdentity $identity '0.2.30'`)).toThrow();
    expect(run(`${prefix} -PublicRelease; Assert-HookPublicBuildIdentity $identity '0.2.30'; $identity.buildVersion`)).toBe("v0.2.30");
    expect(() => run(`${prefix} -PublicRelease; Assert-HookPublicBuildIdentity $identity '0.2.31'`)).toThrow();
  }));

  it.each([-1, 0.5, "1", 65536, null])("rejects malformed revision %s without changing state", { timeout: 30000 }, revision => fixture(root => {
    const path = join(root, "version-state.json");
    writeFileSync(path, JSON.stringify({ publicVersion: "0.2.30", internalRevision: revision }));
    const before = readFileSync(path);
    expect(() => run(`& ${quote(bump)} -RepoRoot ${quote(root)}`)).toThrow();
    expect(readFileSync(path)).toEqual(before);
  }));

  it("rejects stale public bases and revision overflow", { timeout: 60000 }, () => fixture(root => {
    const path = join(root, "version-state.json");
    for (const state of [
      { publicVersion: "0.2.29", internalRevision: 1 },
      { publicVersion: "0.2.30", internalRevision: 65535 },
    ]) {
      writeFileSync(path, JSON.stringify(state));
      expect(() => run(`& ${quote(bump)} -RepoRoot ${quote(root)}`)).toThrow();
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(state);
    }
  }));
});
