import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("context-menu focus-loss contract", () => {
    it("closes the sticker context menu when the app window loses focus or becomes hidden", () => {
        const layer = readSource("src/components/StickerContextMenuLayer.tsx");

        expect(layer).toContain('window.addEventListener("blur", handleWindowBlur)');
        expect(layer).toContain('document.addEventListener("visibilitychange", handleVisibilityChange)');
        expect(layer).toContain('document.visibilityState === "hidden"');
        expect(layer).toContain("closeMenu()");
    });
});
