import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("context-menu capture isolation contract", () => {
    it("closes any open sticker context menu when region capture or long capture becomes active", () => {
        const source = readSource("src/app.tsx");

        expect(source).toContain("stickerContextMenuController.close()");
        expect(source).toContain("isSelecting()");
        expect(source).toContain("longCaptureSession()?.active");
    });

    it("blocks sticker right-click menus from opening while capture flows are active", () => {
        const source = readSource("src/components/UnitView.tsx");

        expect(source).toContain("isSelecting()");
        expect(source).toContain("longCaptureSession()?.active");
        expect(source).toContain("if (isSelecting() || longCaptureSession()?.active)");
    });
});
