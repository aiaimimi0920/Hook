import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const root = process.cwd();
const read = (name: string) => readFileSync(resolve(root, name), "utf8");
const sourceFiles = (directory: string): string[] => {
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const name = resolve(directory, entry.name);
        return entry.isDirectory() ? sourceFiles(name) : /\.(tsx?|css)$/.test(name) ? [name] : [];
    });
};

describe("repository organization", () => {
    it("keeps discoverable contribution rules and domain entrypoints", () => {
        const standard = "docs/development/CODE_ORGANIZATION.md";
        for (const entry of ["AGENTS.md", "CONTRIBUTING.md", "README.md", "README.zh-CN.md"]) {
            expect(read(entry), entry).toContain(standard);
        }
        for (const entry of [
            "src/main.tsx", "src/app/app.tsx", "src/platform/tauri/api.ts",
            "src/features/workspace/state/graphStore.ts", "src/features/workspace/state/uiStore.ts",
            "src/features/capture/hooks/useSelection.ts",
            "src/features/stickers/components/StickerAnnotationLayer.tsx",
            "src/features/tile/components/TileTerminal.tsx",
            "docs/architecture/overview.md", "tests/README.md", "scripts/README.md",
        ]) expect(existsSync(resolve(root, entry)), entry).toBe(true);
    });

    it("does not restore global buckets or reverse dependencies from shared primitives", () => {
        for (const bucket of ["components", "services", "store", "hooks", "types", "styles", "utils"]) {
            expect(sourceFiles(resolve(root, "src", bucket)), bucket).toEqual([]);
        }
        const shared = resolve(root, "src/shared");
        for (const file of sourceFiles(shared)) {
            for (const match of readFileSync(file, "utf8").matchAll(/(?:from\s*|import\s*\(?\s*)["'](\.[^"']+)["']/g)) {
                const target = relative(shared, resolve(dirname(file), match[1]));
                expect(target.startsWith(".."), `${file}: ${match[1]}`).toBe(false);
            }
        }
    });

    it("preserves the independent lazy Tile entry and native include scope", () => {
        const main = read("src/main.tsx");
        expect(main).toContain('await import("./features/tile/components/TileTerminal")');
        expect(main).toContain('await import("./app/app")');
        const lib = read("src-tauri/src/lib.rs");
        expect(lib).toContain('include!("native/runtime/app_runtime.rs")');
        expect(lib).toContain('include!("native/input/capture_mouse_queue.rs")');
        expect(lib).not.toMatch(/^mod (?:native|runtime);/m);
    });
});
