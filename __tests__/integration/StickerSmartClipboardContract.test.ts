import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const clipboardSource = readFileSync(resolve(process.cwd(), "src/hooks/useClipboard.ts"), "utf8");
const apiSource = readFileSync(resolve(process.cwd(), "src/services/api.ts"), "utf8");
const rustSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");

describe("Hook smart sticker clipboard contract", () => {
    it("copies a sticker to one smart system clipboard command so Explorer gets a file and browsers get image data", () => {
        expect(clipboardSource).toContain("api.copyStickerImageToSmartClipboard(exportBase64)");
        expect(clipboardSource).not.toContain("api.copyNodeImageToClipboard(exportBase64)");
        expect(clipboardSource).not.toContain("api.copyToClipboard(exportBase64)");

        expect(apiSource).toContain("copyStickerImageToSmartClipboard");
        expect(apiSource).toContain("copy_sticker_image_to_smart_clipboard");

        expect(rustSource).toContain("fn copy_sticker_image_to_smart_clipboard(base64_image: String) -> Result<String, String>");
        expect(rustSource).toContain("Hook_");
        const imageWriteIndex = rustSource.indexOf(".image(clipboard_image)");
        const fileListWriteIndex = rustSource.indexOf(".file_list(&[file_path.as_path()])");
        expect(imageWriteIndex).toBeGreaterThan(-1);
        expect(fileListWriteIndex).toBeGreaterThan(-1);
        expect(imageWriteIndex).toBeLessThan(fileListWriteIndex);
        expect(rustSource).toContain("copy_sticker_image_to_smart_clipboard,");
    });
});
