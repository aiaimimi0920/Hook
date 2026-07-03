import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fileDropSource = readFileSync(resolve(process.cwd(), "src/hooks/useFileDrop.ts"), "utf8");
const apiSource = readFileSync(resolve(process.cwd(), "src/services/api.ts"), "utf8");
const rustSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
const cargoToml = readFileSync(resolve(process.cwd(), "src-tauri/Cargo.toml"), "utf8");
const buildSource = readFileSync(resolve(process.cwd(), "build-hook-release.bat"), "utf8");
const packageSource = readFileSync(resolve(process.cwd(), "package-hook-release.ps1"), "utf8");

describe("Hook optimization guardrails", () => {
    it("keeps the image import path and the Rust image dependency intact", () => {
        expect(fileDropSource).toContain('endsWith(".png")');
        expect(fileDropSource).toContain('endsWith(".jpg")');
        expect(fileDropSource).toContain('endsWith(".jpeg")');
        expect(fileDropSource).toContain('endsWith(".webp")');
        expect(fileDropSource).toContain('endsWith(".bmp")');
        expect(apiSource).toContain("readImageFromPath");
        expect(rustSource).toContain("fn read_image_from_path");
        expect(cargoToml).toContain('image = "0.25.9"');
    });

    it("keeps release packaging on the canonical Hook release pipeline", () => {
        expect(buildSource).toContain("package-hook-release.ps1");
        expect(packageSource).toContain('"Hook"');
        expect(packageSource).toContain("build-release-exes.ps1");
        expect(rustSource).toContain("clipboard_cache");
    });
});
