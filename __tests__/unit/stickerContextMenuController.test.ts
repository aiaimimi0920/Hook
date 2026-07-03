import { describe, expect, it } from "vitest";
import { createStickerContextMenuController } from "../../src/services/stickerContextMenuController";

describe("stickerContextMenuController", () => {
    it("keeps only one menu target at a time and resets submenu on reopen", () => {
        const controller = createStickerContextMenuController();

        controller.openForSticker("sticker-1", { x: 10, y: 20 });
        controller.openSubmenu("recycleBin", { top: 48 });
        controller.openForSticker("sticker-2", { x: 40, y: 50 });

        expect(controller.state.targetStickerId).toBe("sticker-2");
        expect(controller.state.activeSubmenu).toBe("none");
        expect(controller.state.submenuOffsetY).toBe(0);
        expect(controller.state.mouseX).toBe(40);
        expect(controller.state.mouseY).toBe(50);
    });

    it("tracks submenu vertical anchor so secondary panels can align to the hovered primary row", () => {
        const controller = createStickerContextMenuController();

        controller.openForSticker("sticker-1", { x: 10, y: 20 });
        controller.openSubmenu("referenceLibrary", { top: 72 });

        expect(controller.state.activeSubmenu).toBe("referenceLibrary");
        expect(controller.state.submenuOffsetY).toBe(52);
    });

    it("closes on demand and clears target state", () => {
        const controller = createStickerContextMenuController();

        controller.openForSticker("sticker-1", { x: 10, y: 20 });
        controller.close();

        expect(controller.state.isOpen).toBe(false);
        expect(controller.state.targetStickerId).toBeNull();
        expect(controller.state.activeSubmenu).toBe("none");
        expect(controller.state.submenuOffsetY).toBe(0);
    });
});
