import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
    units: [] as { id: string; type: "sticker" | "art" }[], show: vi.fn(),
}));
vi.mock("../../src/store/graphStore", () => ({ graphStore: state }));
vi.mock("../../src/store/uiStore", () => ({ uiActions: { showEnhancementNotice: state.show } }));
import { showUnitFailureNotice } from "../../src/services/unitFailureNotice";
const notice = { feature: "Interaction" as const, title: "Failure", message: "Safe failure" };
beforeEach(() => { state.units.length = 0; vi.clearAllMocks(); });

it("delivers an unbound failure to the last sticker, not an unrelated Art node", () => {
    state.units.push({ id: "first", type: "sticker" }, { id: "last", type: "sticker" }, { id: "art", type: "art" });
    showUnitFailureNotice(notice);
    expect(state.show).toHaveBeenCalledExactlyOnceWith("last", notice);
});
it("preserves an existing bound owner including Art", () => {
    state.units.push({ id: "art", type: "art" }, { id: "last", type: "sticker" });
    showUnitFailureNotice(notice, "art");
    expect(state.show).toHaveBeenCalledExactlyOnceWith("art", notice);
});
it("resolves a removed asynchronous owner against current stickers", () => {
    state.units.push({ id: "remaining", type: "sticker" });
    showUnitFailureNotice(notice, "deleted");
    expect(state.show).toHaveBeenCalledExactlyOnceWith("remaining", notice);
});
it("does not display anything when no sticker or bound owner exists", () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    try {
        showUnitFailureNotice(notice);
        state.units.push({ id: "art", type: "art" });
        showUnitFailureNotice(notice, "deleted");
        expect(state.show).not.toHaveBeenCalled();
        expect(alert).not.toHaveBeenCalled();
    } finally { alert.mockRestore(); }
});
