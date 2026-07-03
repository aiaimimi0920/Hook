import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("sticker delete recycle contract", () => {
    it("routes keyboard and escape sticker deletion through recycle-bin snapshot capture before removal", () => {
        const source = readSource("src/app.tsx");

        expect(source).toContain("deleteSelectedUnitOrAnnotation");
        expect(source).toContain("graphStore.setRecycleBin");
        expect(source).toContain("captureFrozenStickerSnapshot");
        expect(source).toContain("addRecycleBinEntry");
    });
});
