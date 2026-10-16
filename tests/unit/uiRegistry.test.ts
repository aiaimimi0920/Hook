import { describe, expect, it } from "vitest";

import { addOrUpdateRect, extraRects, removeRect } from "../../src/platform/desktop/uiRegistry";

describe("uiRegistry", () => {
    it("does not replace the rect list when removing an absent rect", () => {
        const missingId = `missing-${Date.now()}-${Math.random()}`;
        const before = extraRects();

        removeRect(missingId);

        expect(extraRects()).toBe(before);
    });

    it("does not replace the rect list when updating with an unchanged rect", () => {
        const rect = {
            id: `stable-${Date.now()}-${Math.random()}`,
            x: 1,
            y: 2,
            width: 3,
            height: 4,
            name: "TEST_RECT",
        };

        addOrUpdateRect(rect);
        const before = extraRects();

        try {
            addOrUpdateRect({ ...rect });

            expect(extraRects()).toBe(before);
        } finally {
            removeRect(rect.id);
        }
    });
});
