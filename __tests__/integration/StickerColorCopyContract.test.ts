import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const colorPickerSource = readFileSync(resolve(process.cwd(), "src/components/ColorPicker.tsx"), "utf8");
const uiStoreSource = readFileSync(resolve(process.cwd(), "src/store/uiStore.ts"), "utf8");

describe("Hook sticker color copy contract", () => {
    it("keeps sampled rgb data and exposes one-click HEX/RGB copy actions from the modal color picker", () => {
        expect(uiStoreSource).toContain("sampledRgb");
        expect(uiStoreSource).toContain("setStickerSampledRgb");

        // Copy actions live in the unified modal color picker (ColorPicker), the
        // single color-editing surface after the legacy popover was removed.
        expect(colorPickerSource).toContain("复制HEX");
        expect(colorPickerSource).toContain("复制RGB");
        expect(colorPickerSource).toContain("navigator.clipboard.writeText");
        expect(colorPickerSource).toContain("rgba(");
    });
});
