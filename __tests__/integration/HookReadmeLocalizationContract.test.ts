import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const readmeEnPath = resolve(process.cwd(), "README.md");
const readmeZhPath = resolve(process.cwd(), "README.zh-CN.md");
const readmeEn = readFileSync(readmeEnPath, "utf8");
const readmeZh = readFileSync(readmeZhPath, "utf8");

describe("Hook README localization contract", () => {
    it("ships both English and Simplified Chinese readmes with reciprocal language links", () => {
        expect(existsSync(readmeEnPath)).toBe(true);
        expect(existsSync(readmeZhPath)).toBe(true);
        expect(readmeEn).toContain("README.zh-CN.md");
        expect(readmeZh).toContain("README.md");
    });

    it("keeps the minimal shared section structure in both languages", () => {
        expect(readmeEn).toContain("## Why Hook");
        expect(readmeEn).toContain("## Core capabilities");
        expect(readmeEn).toContain("## Contributing");
        expect(readmeEn).toContain("## License");

        expect(readmeZh).toContain("## 为什么是 Hook");
        expect(readmeZh).toContain("## 核心能力");
        expect(readmeZh).toContain("## 参与贡献");
        expect(readmeZh).toContain("## 许可证");
    });

    it("keeps contribution links visible in both languages", () => {
        expect(readmeEn).toContain("https://github.com/aiaimimi0920/Hook/issues");
        expect(readmeZh).toContain("https://github.com/aiaimimi0920/Hook/issues");
    });
});
