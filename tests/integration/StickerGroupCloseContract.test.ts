import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const groupBarSource = readFileSync(resolve(process.cwd(), "src/features/stickers/components/StickerGroupBar.tsx"), "utf8");
const groupServiceSource = readFileSync(resolve(process.cwd(), "src/features/stickers/services/stickerGroups.ts"), "utf8");
const graphStoreSource = readFileSync(resolve(process.cwd(), "src/features/workspace/state/graphStore.ts"), "utf8");

describe("Otter sticker group close contract", () => {
    it("supports closing an entire sticker group from the group bar", () => {
        expect(groupBarSource).toContain("关闭组");
        expect(groupBarSource).toContain("closeStickerGroup");

        expect(groupServiceSource).toContain("closeStickerGroupMembers");
        expect(graphStoreSource).toContain("closeStickerGroup");
    });
});
