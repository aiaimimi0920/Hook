import { describe, expect, it, vi } from "vitest";
vi.mock("../../src/services/stickerTextGeometry", () => ({ measureTextWidth: (text: string) => text.length * 10 }));
import { findTextCaretOffset } from "../../src/services/stickerTextCaret";

describe("text click caret boundaries", () => {
    it.each([[-10, 0], [4, 0], [6, 1], [24, 2], [100, 4]])("maps x=%s to offset %s", (x, offset) => {
        expect(findTextCaretOffset("中文ab", x, 24, "Arial")).toBe(offset);
    });
    it("does not split emoji or combining graphemes", () => {
        expect(findTextCaretOffset("a👨‍👩‍👧b", 40, 24, "Arial")).toBe(1);
        expect(findTextCaretOffset("e\u0301b", 12, 24, "Arial")).toBe(2);
        expect(findTextCaretOffset("", 20, 24, "Arial")).toBe(0);
    });
});
