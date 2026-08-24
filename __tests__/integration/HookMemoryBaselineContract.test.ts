import { describe, expect, it } from "vitest";
import { readHookLibRustSources } from "../helpers/hookLibRustSources";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appSource = readFileSync(resolve(process.cwd(), "src/app.tsx"), "utf8");
const propertyBarSource = readFileSync(
    resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx"),
    "utf8",
);
const installedFontLoaderSource = readFileSync(
    resolve(process.cwd(), "src/services/installedStickerFontLoader.ts"),
    "utf8",
);
const unitParamsPanelSource = readFileSync(
    resolve(process.cwd(), "src/components/UnitParamsPanel.tsx"),
    "utf8",
);
const rustSource = readHookLibRustSources();

describe("Hook memory baseline contract", () => {
    it("does not eagerly enumerate installed fonts during startup and instead keeps font loading on demand", () => {
        expect(appSource).not.toContain("loadInstalledFontsInBackground();");
        expect(propertyBarSource).toContain("loadInstalledFontsOnDemand");
        expect(installedFontLoaderSource).toContain("api.getInstalledFonts()");
    });

    it("eagerly installs global overlay hooks during app setup because global shortcuts are fixed baseline behavior", () => {
        expect(rustSource).toContain("install_capture_mouse_hook_thread(window.clone());");
        expect(rustSource).toContain("install_overlay_keyboard_hook_thread(window.clone());");
    });

    it("keeps file-backed images as paths across restore and only normalizes them at display time", () => {
        expect(rustSource).not.toContain('sticker.src = format!("data:image/png;base64,{}", b64);');
        expect(appSource).not.toContain("previewSrc = await api.readImageFromPath(filePath);");
        expect(unitParamsPanelSource).toContain("normalizeImageSourceForDisplay");
    });
});
