import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
    scripts: Record<string, string>;
};
const buildStaticScript = readFileSync(resolve(process.cwd(), "scripts", "build-static.cmd"), "utf8");

describe("Tauri dist cleanup contract", () => {
    it("runs the static build through a cleanup step before Tauri embeds frontendDist", () => {
        expect(packageJson.scripts.build).toContain("scripts\\build-static.cmd");
        expect(buildStaticScript).toContain("scripts\\run-vinxi.cmd build");
        expect(buildStaticScript).toContain("scripts\\clean-tauri-dist.mjs");
    });

    it("removes only inert generated compression/icon files and keeps Vinxi runtime manifests", async () => {
        const root = mkdtempSync(join(tmpdir(), "hook-tauri-dist-"));
        try {
            const publicDir = join(root, ".output", "public");
            mkdirSync(join(publicDir, "_build", ".vite"), { recursive: true });
            mkdirSync(join(publicDir, "_build", "assets"), { recursive: true });
            mkdirSync(join(publicDir, "_server", "assets"), { recursive: true });

            writeFileSync(join(publicDir, "index.html"), "<script src=\"/_build/assets/app.js\"></script>");
            writeFileSync(join(publicDir, "index.html.gz"), "compressed");
            writeFileSync(join(publicDir, "index.html.br"), "compressed");
            writeFileSync(join(publicDir, "tauri.svg"), "icon");
            writeFileSync(join(publicDir, "tauri.svg.gz"), "compressed");
            writeFileSync(join(publicDir, "vite.svg"), "unused");
            writeFileSync(join(publicDir, "_build", ".vite", "manifest.json"), "{}");
            writeFileSync(join(publicDir, "_build", "assets", "app.js"), "app");
            writeFileSync(join(publicDir, "_build", "assets", "app.js.gz"), "compressed");
            writeFileSync(join(publicDir, "_build", "assets", "app.js.br"), "compressed");
            writeFileSync(join(publicDir, "_server", "assets", "app.css"), "server-css");

            const cleanupModule = await import("../../scripts/clean-tauri-dist.mjs");
            const result = cleanupModule.cleanTauriDist(publicDir);

            expect(result.removedFiles.sort()).toEqual([
                "_build/assets/app.js.br",
                "_build/assets/app.js.gz",
                "index.html.br",
                "index.html.gz",
                "tauri.svg.gz",
                "vite.svg",
            ].sort());
            expect(result.removedDirectories).toEqual([]);

            expect(existsSync(join(publicDir, "index.html"))).toBe(true);
            expect(existsSync(join(publicDir, "tauri.svg"))).toBe(true);
            expect(existsSync(join(publicDir, "_build", "assets", "app.js"))).toBe(true);
            expect(existsSync(join(publicDir, "_build", ".vite", "manifest.json"))).toBe(true);
            expect(existsSync(join(publicDir, "_server", "assets", "app.css"))).toBe(true);
            expect(existsSync(join(publicDir, "vite.svg"))).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
