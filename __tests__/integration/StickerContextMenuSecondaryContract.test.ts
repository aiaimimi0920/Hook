import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("secondary context-menu contract", () => {
    it("uses a shared StickerSnapshotListPanel for recycle-bin and reference-library submenus", () => {
        const layer = readSource("src/components/StickerContextMenuLayer.tsx");

        expect(layer).toContain("StickerSnapshotListPanel");
        expect(layer).toContain('"recycleBin"');
        expect(layer).toContain('"referenceLibrary"');
        expect(layer).toContain("submenuOffsetY");
    });

    it("wires submenu restore and copy behavior through the snapshot library helpers", () => {
        const layer = readSource("src/components/StickerContextMenuLayer.tsx");

        expect(layer).toContain("restoreRecycleBinEntry");
        expect(layer).toContain("copyReferenceEntry");
        expect(layer).toContain("onLeftActivate");
        expect(layer).toContain("onRightActivate");
    });

    it("keeps the primary reference action state-driven instead of hardcoded", () => {
        const panel = readSource("src/components/StickerContextMenuPanel.tsx");

        expect(panel).toContain("referenceActionLabel");
    });

    it("opens the submenu from the hovered row anchor instead of from a generic root gap", () => {
        const panel = readSource("src/components/StickerContextMenuPanel.tsx");
        const layer = readSource("src/components/StickerContextMenuLayer.tsx");

        expect(panel).toContain("getBoundingClientRect");
        expect(panel).toContain("props.onOpenSubmenu(submenu, { top: rect.top })");
        expect(layer).toContain("onOpenSubmenu={(submenu, anchor) => stickerContextMenuController.openSubmenu(submenu, anchor)}");
        expect(layer).toContain('"margin-top": `${stickerContextMenuController.state.submenuOffsetY}px`');
        expect(layer).toContain("gap-0");
    });

    it("uses rectangular primary and secondary menu shells instead of rounded cards", () => {
        const panel = readSource("src/components/StickerContextMenuPanel.tsx");
        const list = readSource("src/components/StickerSnapshotListPanel.tsx");

        expect(panel).not.toContain("rounded-xl");
        expect(panel).not.toContain("rounded-md");
        expect(list).not.toContain("rounded-xl");
        expect(list).not.toContain("rounded-lg");
    });

    it("uses a fixed 3-column submenu grid with 5px spacing so recycle entries render three separated items per row", () => {
        const list = readSource("src/components/StickerSnapshotListPanel.tsx");

        expect(list).toContain("grid-cols-3");
        expect(list).toContain("gap-[5px]");
        expect(list).toContain("p-[5px]");
        expect(list).toContain("overflow-x-hidden");
        expect(list).toContain("min-h-[82px]");
    });
});
