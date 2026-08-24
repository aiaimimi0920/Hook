import { describe, expect, it } from "vitest";
import { readHookLibRustSources } from "../helpers/hookLibRustSources";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const clipboardSource = readFileSync(resolve(process.cwd(), "src/hooks/useClipboard.ts"), "utf8");
const imageResourceApiSource = readFileSync(resolve(process.cwd(), "src/services/apiImageResource.ts"), "utf8");
const sessionHistoryApiSource = readFileSync(resolve(process.cwd(), "src/services/apiSessionHistory.ts"), "utf8");
const rustSource = readHookLibRustSources();
const cargoToml = readFileSync(resolve(process.cwd(), "src-tauri/Cargo.toml"), "utf8");

describe("Hook Ctrl+S sticker save-as contract", () => {
    it("keeps session autosave separate while routing manual sticker save through a native save-as dialog near the sticker center", () => {
        expect(clipboardSource).toContain("const centerX = unit.x + unit.w / 2");
        expect(clipboardSource).toContain("const centerY = unit.y + unit.h / 2");
        expect(clipboardSource).toContain("api.saveStickerImageAs(");
        expect(clipboardSource).toContain("buildUnitFileNamingContext(unit)");
        expect(clipboardSource).not.toContain("api.saveStickerImage(exportBase64)");

        expect(imageResourceApiSource).toContain("saveStickerImageAs");
        expect(imageResourceApiSource).toContain("save_sticker_image_as");
        expect(imageResourceApiSource).toContain("dialogCenterX");
        expect(imageResourceApiSource).toContain("dialogCenterY");
        expect(sessionHistoryApiSource).toContain("saveSession");
        expect(sessionHistoryApiSource).toContain("save_session");

        expect(rustSource).toContain("fn save_sticker_image_as(");
        expect(rustSource).toContain("dialog_center_x: f64");
        expect(rustSource).toContain("dialog_center_y: f64");
        expect(rustSource).toContain("GetSaveFileNameW");
        expect(rustSource).toContain("SaveDialogPlacement");
        expect(rustSource).toContain("OFN_ENABLEHOOK");
        expect(rustSource).toContain("SetWindowPos");
        expect(rustSource).toContain("NATIVE_FILE_DIALOG_ACTIVE");
        expect(rustSource).toContain("fn run_with_native_file_dialog_input_passthrough");
        expect(rustSource).toContain("hide_overlay_input_shield_window();");
        expect(rustSource).toContain("refresh_overlay_interactivity_from_runtime_state");
        expect(rustSource).toContain("run_with_native_file_dialog_input_passthrough(");
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
