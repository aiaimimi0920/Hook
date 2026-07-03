import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const verifyScriptPath = resolve(process.cwd(), "verify-hook-full.bat");

describe("Hook full verification script contract", () => {
    it("runs the complete local verification gate before a release is considered valid", () => {
        expect(existsSync(verifyScriptPath)).toBe(true);
        const verifySource = readFileSync(verifyScriptPath, "utf8");

        expect(verifySource).toContain("npm run typecheck");
        expect(verifySource).toContain("npm test");
        expect(verifySource).toContain("npm run build");
        expect(verifySource).toContain("build-hook-release.bat");
        expect(verifySource.indexOf("npm run typecheck")).toBeLessThan(verifySource.indexOf("npm test"));
        expect(verifySource.indexOf("npm test")).toBeLessThan(verifySource.indexOf("npm run build"));
        expect(verifySource.indexOf("npm run build")).toBeLessThan(verifySource.indexOf("build-hook-release.bat"));
    });
});
