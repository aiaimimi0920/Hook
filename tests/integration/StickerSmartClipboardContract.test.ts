import { describe, expect, it } from "vitest";
import { readOtterLibRustSources } from "../helpers/otterLibRustSources";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const clipboardSource = readFileSync(resolve(process.cwd(), "src/features/workspace/hooks/useClipboard.ts"), "utf8");
const imageResourceApiSource = readFileSync(resolve(process.cwd(), "src/platform/tauri/apiImageResource.ts"), "utf8");
const rustSource = readOtterLibRustSources();

describe("Otter smart sticker clipboard contract", () => {
    it("copies a sticker to one smart system clipboard command so Explorer gets a file and browsers get image data", () => {
        expect(clipboardSource).toContain("api.copyStickerImageToSmartClipboard(");
        expect(clipboardSource).toContain("buildUnitFileNamingContext(unit)");
        expect(clipboardSource).not.toContain("api.copyNodeImageToClipboard(exportBase64)");
        expect(clipboardSource).not.toContain("api.copyToClipboard(exportBase64)");

        expect(imageResourceApiSource).toContain("copyStickerImageToSmartClipboard");
        expect(imageResourceApiSource).toContain("copy_sticker_image_to_smart_clipboard");

        expect(rustSource).toContain("fn copy_sticker_image_to_smart_clipboard(");
        expect(rustSource).toContain("FileNamingPatternKind::ClipboardFile");
        const imageWriteIndex = rustSource.indexOf(".image(clipboard_image)");
        const fileListWriteIndex = rustSource.indexOf(".file_list(&[file_path.as_path()])");
        expect(imageWriteIndex).toBeGreaterThan(-1);
        expect(fileListWriteIndex).toBeGreaterThan(-1);
        expect(imageWriteIndex).toBeLessThan(fileListWriteIndex);
        expect(rustSource).toContain("copy_sticker_image_to_smart_clipboard,");
    });
});
