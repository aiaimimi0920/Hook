import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const readmeEnPath = resolve(process.cwd(), "README.md");
const readmeZhPath = resolve(process.cwd(), "README.zh-CN.md");
const heroPath = resolve(process.cwd(), "docs/assets/github-home-hero.svg");
const readmeEn = readFileSync(readmeEnPath, "utf8");
const readmeZh = readFileSync(readmeZhPath, "utf8");

describe("Hook GitHub homepage localization contract", () => {
    it("ships both English and Simplified Chinese homepage readmes", () => {
        expect(existsSync(readmeEnPath)).toBe(true);
        expect(existsSync(readmeZhPath)).toBe(true);
        expect(readmeEn).toContain("README.zh-CN.md");
        expect(readmeZh).toContain("README.md");
    });

    it("uses the shared GitHub homepage hero asset in both language versions", () => {
        expect(existsSync(heroPath)).toBe(true);
        expect(readmeEn).toContain("docs/assets/github-home-hero.svg");
        expect(readmeZh).toContain("docs/assets/github-home-hero.svg");
    });
});
