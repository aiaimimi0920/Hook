import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const shortcutsSource = readFileSync(resolve(process.cwd(), "src/services/shortcuts.ts"), "utf8");
const appSource = readFileSync(resolve(process.cwd(), "src/app.tsx"), "utf8");
const captureStateSource = readFileSync(resolve(process.cwd(), "src/services/captureState.ts"), "utf8");
const layerSource = readFileSync(resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"), "utf8");
const uiStoreSource = readFileSync(resolve(process.cwd(), "src/store/uiStore.ts"), "utf8");

describe("Hook sticker edit cancel contract", () => {
    it("uses Escape to cancel active sticker drawing/edit drafts without deleting the sticker", () => {
        expect(shortcutsSource).toContain("cancel-sticker-edit");
        expect(shortcutsSource).toContain("context: 'sticker-editing'");

        expect(appSource).toContain("resolveShortcutContext");
        expect(captureStateSource).toContain("return \"sticker-editing\"");
        expect(appSource).toContain("onCancelStickerEdit");

        expect(uiStoreSource).toContain("stickerEditCancelToken");
        expect(uiStoreSource).toContain("requestStickerEditCancel");

        expect(layerSource).toContain("stickerEditCancelToken");
        expect(layerSource).toContain("setDraftShape(null)");
        expect(layerSource).toContain("setDraftLine(null)");
    });
});
