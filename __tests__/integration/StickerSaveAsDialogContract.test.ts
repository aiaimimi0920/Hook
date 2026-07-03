import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const clipboardSource = readFileSync(resolve(process.cwd(), "src/hooks/useClipboard.ts"), "utf8");
const apiSource = readFileSync(resolve(process.cwd(), "src/services/api.ts"), "utf8");
const rustSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
const cargoToml = readFileSync(resolve(process.cwd(), "src-tauri/Cargo.toml"), "utf8");

describe("Hook Ctrl+S sticker save-as contract", () => {
    it("keeps session autosave separate while routing manual sticker save through a native save-as dialog near the sticker center", () => {
        expect(clipboardSource).toContain("const centerX = unit.x + unit.w / 2");
        expect(clipboardSource).toContain("const centerY = unit.y + unit.h / 2");
        expect(clipboardSource).toContain("api.saveStickerImageAs(exportBase64, centerX, centerY)");
        expect(clipboardSource).not.toContain("api.saveStickerImage(exportBase64)");

        expect(apiSource).toContain("saveStickerImageAs");
        expect(apiSource).toContain("save_sticker_image_as");
        expect(apiSource).toContain("dialogCenterX");
        expect(apiSource).toContain("dialogCenterY");
        expect(apiSource).toContain("saveSession");
        expect(apiSource).toContain("save_session");

        expect(rustSource).toContain("fn save_sticker_image_as(");
        expect(rustSource).toContain("dialog_center_x: f64");
        expect(rustSource).toContain("dialog_center_y: f64");
        expect(rustSource).toContain("GetSaveFileNameW");
        expect(rustSource).toContain("SaveDialogPlacement");
        expect(rustSource).toContain("OFN_ENABLEHOOK");
        expect(rustSource).toContain("SetWindowPos");
        expect(rustSource).toContain("save_sticker_image_as,");

        const manualSaveIndex = rustSource.indexOf("fn save_sticker_image_as(");
        const sessionSaveIndex = rustSource.indexOf("fn save_session(");
        expect(manualSaveIndex).toBeGreaterThan(-1);
        expect(sessionSaveIndex).toBeGreaterThan(-1);
        expect(manualSaveIndex).toBeLessThan(sessionSaveIndex);

        expect(cargoToml).toContain('"Win32_UI_Controls_Dialogs"');
        expect(cargoToml).not.toContain("tauri-plugin-dialog");
    });
});
