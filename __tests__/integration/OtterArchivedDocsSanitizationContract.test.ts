import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const docsRoot = resolve(process.cwd(), "docs");
const bannedPatterns = [
    "C:\\Users\\Public\\nas_home\\AI\\GameEditor\\Neuro",
    "C:/Users/Public/nas_home/AI/GameEditor/Neuro",
    "Z:\\project\\project\\ArtNexus-GitHub\\ArtHook",
    "C:\\Users\\vmjcv\\AppData\\Roaming\\ArtNexus\\workflows",
];

function listMarkdownFiles(root: string): string[] {
    const results: string[] = [];
    for (const entry of readdirSync(root)) {
        const fullPath = join(root, entry);
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
            results.push(...listMarkdownFiles(fullPath));
            continue;
        }
        if (fullPath.endsWith(".md")) {
            results.push(fullPath);
        }
    }
    return results;
}

describe("Otter archived docs sanitization contract", () => {
    it("does not retain machine-local absolute path roots inside docs/", () => {
        const files = listMarkdownFiles(docsRoot);
        const violations: string[] = [];

        for (const filePath of files) {
            const source = readFileSync(filePath, "utf8");
            for (const pattern of bannedPatterns) {
                if (source.includes(pattern)) {
                    violations.push(`${relative(docsRoot, filePath)} :: ${pattern}`);
                }
            }
        }

        expect(violations).toEqual([]);
    });

    it("documents the placeholder-root convention for archived docs", () => {
        const readmeSource = readFileSync(join(docsRoot, "README.md"), "utf8");
        expect(readmeSource).toContain("<otter-repo-root>");
        expect(readmeSource).toContain("<legacy-artotter-root>");
        expect(readmeSource).toContain("<legacy-artnexus-workflows-root>");
    });
});
