import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("spawned Art node sizing contract", () => {
    it("sizes a newly generated Art node from the source image frame instead of the old fixed frame", () => {
        const source = readFileSync(resolve(process.cwd(), "src", "hooks", "useUnitActions.ts"), "utf8");

        expect(source).toContain("const sourceFrame = getSourceImageFrame(u)");
        expect(source).toContain("w: sourceFrame.w");
        expect(source).toContain("h: sourceFrame.h");
        expect(source).not.toContain("w: 250, h: 300");
    });
});
