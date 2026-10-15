import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const readmeEnPath = resolve(process.cwd(), "README.md");
const readmeZhPath = resolve(process.cwd(), "README.zh-CN.md");
const readmeEn = readFileSync(readmeEnPath, "utf8");
const readmeZh = readFileSync(readmeZhPath, "utf8");
const docsIndex = readFileSync(resolve(process.cwd(), "docs/README.md"), "utf8");
const capabilitiesEn = readFileSync(resolve(process.cwd(), "docs/guide/capabilities.md"), "utf8");
const capabilitiesZh = readFileSync(resolve(process.cwd(), "docs/guide/capabilities.zh-CN.md"), "utf8");

describe("Otter README localization contract", () => {
    it("ships both English and Simplified Chinese readmes with reciprocal language links", () => {
        expect(existsSync(readmeEnPath)).toBe(true);
        expect(existsSync(readmeZhPath)).toBe(true);
        expect(readmeEn).toContain("README.zh-CN.md");
        expect(readmeZh).toContain("README.md");
    });

    it("keeps the minimal shared section structure in both languages", () => {
        expect(readmeEn).toContain("## Features");
        expect(readmeEn).toContain("## Get started");
        expect(readmeEn).toContain("## Contributing");
        expect(readmeEn).toContain("## License");

        expect(readmeZh).toContain("## 功能");
        expect(readmeZh).toContain("## 快速开始");
        expect(readmeZh).toContain("## 参与贡献");
        expect(readmeZh).toContain("## 许可证");

        expect(readmeEn).toContain("./docs/README.md");
        expect(readmeZh).toContain("./docs/README.md");
        expect(docsIndex).toContain("guide/capabilities.md");
        expect(docsIndex).toContain("guide/capabilities.zh-CN.md");
        expect(capabilitiesEn).toContain("## Why Otter");
        expect(capabilitiesEn).toContain("## Core capabilities");
        expect(capabilitiesZh).toContain("## 为什么是 Otter");
        expect(capabilitiesZh).toContain("## 核心能力");
    });

    it("keeps contribution links visible in both languages", () => {
        expect(readmeEn).toContain("https://github.com/aiaimimi0920/Otter/issues");
        expect(readmeZh).toContain("https://github.com/aiaimimi0920/Otter/issues");
    });
});
