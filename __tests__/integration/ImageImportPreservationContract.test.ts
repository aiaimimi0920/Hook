import { describe, expect, it } from "vitest";
import { readHookLibRustSources } from "../helpers/hookLibRustSources";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fileDropSource = readFileSync(resolve(process.cwd(), "src/hooks/useFileDrop.ts"), "utf8");
const imageResourceApiSource = readFileSync(resolve(process.cwd(), "src/services/apiImageResource.ts"), "utf8");
const rustSource = readHookLibRustSources();
const cargoToml = readFileSync(resolve(process.cwd(), "src-tauri/Cargo.toml"), "utf8");

describe("Hook image import preservation contract", () => {
    it("keeps the current drag-in image formats and the backend image crate", () => {
        // The drop handler now matches against a SUPPORTED_IMAGE_EXTENSIONS list
        // via endsWith rather than inline endsWith(".png") calls. Assert the
        // supported formats are present in that list (behavior), not the exact
        // call syntax (which broke on refactor).
        expect(fileDropSource).toContain('".png"');
        expect(fileDropSource).toContain('".jpg"');
        expect(fileDropSource).toContain('".jpeg"');
        expect(fileDropSource).toContain('".webp"');
        expect(fileDropSource).toContain('".bmp"');
        expect(fileDropSource).toContain("endsWith(extension)");
        expect(imageResourceApiSource).toContain("readImageFromPath");
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
