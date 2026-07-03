import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const canvasUnitsSource = readFileSync(resolve(process.cwd(), "src/components/CanvasUnits.tsx"), "utf8");
const appSource = readFileSync(resolve(process.cwd(), "src/app.tsx"), "utf8");
const selectionSource = readFileSync(resolve(process.cwd(), "src/components/CanvasSelection.tsx"), "utf8");
const groupBarSource = readFileSync(resolve(process.cwd(), "src/components/StickerGroupBar.tsx"), "utf8");

describe("Hook group and long-capture presentation contract", () => {
    it("shows a group bar, filters units by the active group, and labels long-capture mode in the selection overlay", () => {
        expect(appSource).toContain("StickerGroupBar");
        expect(groupBarSource).toContain("重命名组");
        expect(groupBarSource).toContain("删除组");
        expect(canvasUnitsSource).toContain("activeStickerGroupId");
        expect(canvasUnitsSource).toContain("unit.data.groupId !== activeGroup");
        expect(selectionSource).toContain('captureMode() === "long-vertical"');
        expect(selectionSource).toContain("长截图");
    });
});
