import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

type AssetRecord = { name: string; path: string; bytes: number };
type PublicationModule = {
  collectExpectedAssets: (
    packageDirectory: string,
    tag: string,
    signingCandidatePath: string,
  ) => AssetRecord[];
  compareAssets: (
    expected: AssetRecord[],
    actual: Array<{ name: string; size: number; digest?: string }>,
  ) => Promise<void>;
};

const require = createRequire(import.meta.url);
const publication = require(
  resolve(process.cwd(), ".github/scripts/release-publication.cjs"),
) as PublicationModule;
const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

function writeFixture(path: string, value: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

describe("formal release security contract", () => {
  it("pins every external GitHub Action to an immutable commit", () => {
    const workflowRoot = resolve(process.cwd(), ".github/workflows");
    for (const name of readdirSync(workflowRoot).filter((entry) => entry.endsWith(".yml"))) {
      const source = readFileSync(join(workflowRoot, name), "utf8");
      for (const match of source.matchAll(/^\s*uses:\s+([^\s#]+@[^\s#]+)\s*(?:#.*)?$/gm)) {
        const action = match[1];
        expect(action, `${name} uses a mutable action reference`).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });

  it("keeps clean-source, bounded-input, path, checksum, SBOM, and draft gates", () => {
    const build = readSource("scripts/build-release.ps1");
    const verify = readSource("scripts/verify-release.ps1");
    const pathSafety = readSource("scripts/release/PathSafety.ps1");
    const headlessSmoke = readSource("scripts/Invoke-HookHeadlessReleaseSmoke.ps1");
    const workflow = readSource(".github/workflows/release-hook-tag.yml");

    expect(readSource(".gitignore")).toContain("/release/");

    expect(build).toContain("RequireCleanSource");
    expect(build.indexOf("Formal Hook release requires a clean")).toBeLessThan(
      build.indexOf("New-Item -ItemType Directory -Path $destination"),
    );
    expect(verify).toContain("Read-HookBoundedText");
    expect(verify).toContain("Get-HookArchiveEntries");
    expect(verify).toContain("Read-HookArchiveEntryText");
    expect(verify).toContain("Embedded Hook build provenance does not match packaged hook.exe");
    expect(verify).toContain("RunHeadlessSmoke");
    expect(headlessSmoke).toContain("--self-check");
    expect(headlessSmoke).toContain("HOOK_SELF_CHECK_OUTPUT");
    expect(headlessSmoke).toContain("Headless Hook self-check timed out");
    expect(verify).toContain("Hook checksum inventory is incomplete");
    expect(verify).toContain("CycloneDX SBOM contract failed");
    expect(pathSafety).toContain("IsPathRooted");
    expect(pathSafety).toContain("ReparsePoint");
    expect(pathSafety).toContain("Assert-HookAbsolutePathNoReparsePoints");
    expect(pathSafety).toContain("MaxUncompressedBytes");
    expect(workflow).toContain("draft: true");
    expect(workflow).toContain("publishVerifiedDraft");
    expect(workflow).toContain("-RunHeadlessSmoke");
    expect(workflow).toContain("Effective-line ratchet failed with exit code");
    expect(workflow).toContain("Dependency security contract failed with exit code");
    expect(workflow).toContain("hook-formal-release-smoke-");
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain(
      "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    );
    expect(workflow).toContain(
      "path: artifacts/release-smoke/${{ env.HOOK_TAG }}-headless",
    );
    expect(workflow).toContain("if-no-files-found: error");
    expect(workflow).toContain("deleteFailedDraft");
    expect(workflow).toContain("actions/attest-build-provenance@e8998f949152b193b063cb0ec769d69d929409be");
    expect(workflow).toContain("actions/attest-sbom@bd218ad0dbcb3e146bd073d1d9c6d78e08aa8a0b");
  });

  it("requires the exact formal asset set and verifies remote digests", async () => {
    const root = mkdtempSync(join(tmpdir(), "hook-release-contract-"));
    const tag = "V9.8.7";
    try {
      const releaseRoot = join(root, tag);
      const candidate = join(root, `hook-uiaccess-signing-candidate-${tag}.json`);
      const paths = [
        join(releaseRoot, "packages", `hook-windows-x64-${tag}.zip`),
        join(releaseRoot, "packages", `hook-windows-x64-${tag}.zip.sha256`),
        join(releaseRoot, "sbom", `Hook-${tag}.cdx.json`),
        join(releaseRoot, "sbom", `Hook-${tag}.spdx.json`),
        join(releaseRoot, "provenance", "build-provenance.json"),
        join(releaseRoot, "manifest.json"),
        join(releaseRoot, "checksums.sha256"),
        candidate,
      ];
      paths.forEach((path, index) => writeFixture(path, `fixture-${index}`));

      const expected = publication.collectExpectedAssets(
        releaseRoot,
        tag,
        candidate,
      );
      expect(expected).toHaveLength(8);
      const actual = expected.map((record) => ({
        name: record.name,
        size: statSync(record.path).size,
        digest: `sha256:${createHash("sha256").update(readFileSync(record.path)).digest("hex")}`,
      }));
      await expect(publication.compareAssets(expected, actual)).resolves.toBeUndefined();
      await expect(
        publication.compareAssets(expected, [
          ...actual,
          { name: "unexpected.exe", size: 1 },
        ]),
      ).rejects.toThrow("asset set mismatch");
      await expect(
        publication.compareAssets(expected, actual.map((asset, index) =>
          index === 0 ? { ...asset, digest: `sha256:${"0".repeat(64)}` } : asset,
        )),
      ).rejects.toThrow("digest mismatch");
      await expect(
        publication.compareAssets(expected, actual.map((asset, index) =>
          index === 0 ? { name: asset.name, size: asset.size } : asset,
        )),
      ).rejects.toThrow("digest is missing");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
