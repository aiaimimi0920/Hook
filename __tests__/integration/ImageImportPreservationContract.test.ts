import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fileDropSource = readFileSync(resolve(process.cwd(), "src/hooks/useFileDrop.ts"), "utf8");
const apiSource = readFileSync(resolve(process.cwd(), "src/services/api.ts"), "utf8");
const rustSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
const cargoToml = readFileSync(resolve(process.cwd(), "src-tauri/Cargo.toml"), "utf8");

describe("Hook image import preservation contract", () => {
    it("keeps the current drag-in image formats and the backend image crate", () => {
        expect(fileDropSource).toContain('endsWith(".png")');
        expect(fileDropSource).toContain('endsWith(".jpg")');
        expect(fileDropSource).toContain('endsWith(".jpeg")');
        expect(fileDropSource).toContain('endsWith(".webp")');
        expect(fileDropSource).toContain('endsWith(".bmp")');
        expect(apiSource).toContain("readImageFromPath");
        expect(rustSource).toContain("fn read_image_from_path");
        expect(cargoToml).toContain('image = "0.25.9"');
    });

    it("uses image-format detection instead of extension-only MIME guessing", () => {
        expect(rustSource).toContain("ImageFormat::from_path");
        expect(rustSource).toContain("image/png");
        expect(rustSource).toContain("image/jpeg");
        expect(rustSource).toContain("image/webp");
    });
});
