import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("primary context-menu contract", () => {
    it("mounts a top-level StickerContextMenuLayer from app.tsx", () => {
        expect(readSource("src/app.tsx")).toContain("StickerContextMenuLayer");
    });

    it("opens a sticker menu from UnitView right click instead of relying on browser defaults", () => {
        const source = readSource("src/components/UnitView.tsx");
        expect(source).toContain("onContextMenu");
        expect(source).toContain("openForSticker");
    });
});
