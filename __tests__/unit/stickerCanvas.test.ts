import { describe, expect, it } from "vitest";

import { getStrokeDashArray } from "../../src/components/stickerAnnotationModel";
import { getDashSegments } from "../../src/services/stickerCanvas";

describe("sticker canvas dash patterns", () => {
    it("matches the live SVG dash cadence instead of scaling by stroke width", () => {
        expect(getStrokeDashArray("dash-1")).toBe("8 4");
        expect(getStrokeDashArray("dash-2")).toBe("4 2 1 2");

        expect(getDashSegments("dash-1", 1).join(" ")).toBe("8 4");
        expect(getDashSegments("dash-1", 6).join(" ")).toBe("8 4");
        expect(getDashSegments("dash-2", 1).join(" ")).toBe("4 2 1 2");
        expect(getDashSegments("dash-2", 10).join(" ")).toBe("4 2 1 2");
    });
});
