import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const colorPickerSource = readFileSync(resolve(process.cwd(), "src/features/workspace/components/ColorPicker.tsx"), "utf8");
const uiStoreSource = readFileSync(resolve(process.cwd(), "src/features/workspace/state/uiStore.ts"), "utf8");

describe("Otter sticker color copy contract", () => {
    it("keeps sampled rgb data and routes primary and context clicks to HEX and RGB copy", () => {
        expect(uiStoreSource).toContain("sampledRgb");
        expect(uiStoreSource).toContain("setStickerSampledRgb");

        // Copy actions live in the unified modal color picker (ColorPicker), the
        // single color-editing surface after the legacy popover was removed.
        expect(colorPickerSource).toContain('aria-label="复制当前颜色 HEX"');
        expect(colorPickerSource).toContain("onClick={handleCopyHex}");
        expect(colorPickerSource).toContain("onContextMenu={(event) => { event.preventDefault(); handleCopyRgb(); }}");
        expect(colorPickerSource).toContain("const clipboard = navigator.clipboard");
        expect(colorPickerSource).toContain("clipboard.writeText(text)");
        expect(colorPickerSource).toContain("rgba(");
    });
});
