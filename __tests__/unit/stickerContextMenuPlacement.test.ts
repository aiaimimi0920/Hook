import { describe, expect, it } from "vitest";
import { placeStickerContextMenu, placeStickerSubmenu } from "../../src/services/stickerContextMenuPlacement";

const bounds = { left: 8, top: 8, width: 984, height: 684 };
const size = { width: 260, height: 390 };
describe("context menu viewport avoidance", () => {
    it("keeps the row alignment and right-side placement when space permits", () => {
        expect(placeStickerSubmenu({ left: 100, top: 100, width: 200, height: 320 }, 160, size, bounds))
            .toEqual({ left: 300, top: 160, side: "right" });
    });
    it("shifts a low submenu up without moving the main menu or losing horizontal adjacency", () => {
        expect(placeStickerSubmenu({ left: 100, top: 350, width: 200, height: 320 }, 620, size, bounds))
            .toEqual({ left: 300, top: 302, side: "right" });
    });
    it("flips to the left near the right edge and still avoids bottom overflow", () => {
        expect(placeStickerSubmenu({ left: 790, top: 350, width: 200, height: 320 }, 620, size, bounds))
            .toEqual({ left: 530, top: 302, side: "left" });
    });
    it("clamps top overflow and supports nonzero viewport origins", () => {
        expect(placeStickerSubmenu({ left: 300, top: 100, width: 200, height: 320 }, -20, size, bounds).top).toBe(8);
        expect(placeStickerContextMenu({ x: 990, y: 690 }, { width: 200, height: 320 }, bounds))
            .toEqual({ left: 792, top: 372 });
    });
});
