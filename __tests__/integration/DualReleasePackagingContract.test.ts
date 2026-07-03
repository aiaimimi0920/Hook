import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const scriptPath = resolve(process.cwd(), "package-hook-release.ps1");

describe("Hook dual release packaging contract", () => {
    it("delegates Hook packaging to the canonical Neuro release archive script", () => {
        expect(existsSync(scriptPath)).toBe(true);

        const source = readFileSync(scriptPath, "utf8");

        expect(source).toContain("scripts\\build-release-exes.ps1");
        expect(source).toContain("-Apps");
        expect(source).toContain("Hook");
        expect(source).toContain("-VersionId");
        expect(source).toContain("-NoZip");
        expect(source).toContain("-Force");
        expect(source).toContain("-DryRun");
        expect(source).toContain("[switch]$NoUpx");

        expect(source).not.toContain("Join-Path $root \"release\"");
        expect(source).not.toContain("$PackageName-upx");
        expect(source).not.toContain("Get-Command upx");
        expect(source).not.toContain("--best --lzma");
        expect(source).not.toContain("Hook-Foundation-Windows-x64");
    });
});
