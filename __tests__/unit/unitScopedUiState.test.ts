import { beforeEach, describe, expect, it } from "vitest";

import { createEmptyStickerHistory } from "../../src/services/stickerHistory";
import {
    enhancementNotices,
    setEnhancementNotices,
    setStickerEditHistories,
    setUnitUiState,
    stickerEditHistories,
    uiActions,
    unitUiState,
} from "../../src/store/uiStore";

describe("unit-scoped UI state lifecycle", () => {
    beforeEach(() => {
        uiActions.retainUnitScopedState(new Set());
    });

    it("retains live unit entries and removes stale workspace entries", () => {
        setStickerEditHistories("keep", createEmptyStickerHistory());
        setStickerEditHistories("drop", createEmptyStickerHistory());
        setEnhancementNotices("keep", { title: "keep", message: "keep" });
        setEnhancementNotices("drop", { title: "drop", message: "drop" });
        setUnitUiState("keep", { showActions: true, showParams: false });
        setUnitUiState("drop", { showActions: false, showParams: true });

        uiActions.retainUnitScopedState(new Set(["keep"]));

        expect(stickerEditHistories.keep).toBeDefined();
        expect(stickerEditHistories.drop).toBeUndefined();
        expect(enhancementNotices.keep).toBeDefined();
        expect(enhancementNotices.drop).toBeUndefined();
        expect(unitUiState.keep).toBeDefined();
        expect(unitUiState.drop).toBeUndefined();
    });
});
