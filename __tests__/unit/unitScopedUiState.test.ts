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
import {
    MAX_ENHANCEMENT_NOTICES_PER_UNIT,
    orderEnhancementNoticesForDisplay,
} from "../../src/services/enhancementNoticeQueue";

describe("unit-scoped UI state lifecycle", () => {
    beforeEach(() => {
        uiActions.retainUnitScopedState(new Set());
    });

    it("retains live unit entries and removes stale workspace entries", () => {
        setStickerEditHistories("keep", createEmptyStickerHistory());
        setStickerEditHistories("drop", createEmptyStickerHistory());
        setEnhancementNotices("keep", [{ id: 1, feature: "OCR", title: "keep", message: "keep" }]);
        setEnhancementNotices("drop", [{ id: 2, feature: "OCR", title: "drop", message: "drop" }]);
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

    it("queues unit notices with a bound and dismisses only the clicked entry", () => {
        for (let index = 0; index < MAX_ENHANCEMENT_NOTICES_PER_UNIT + 2; index += 1) {
            uiActions.showEnhancementNotice("unit", {
                feature: "OCR",
                title: `notice ${index}`,
                message: "message",
            });
        }

        expect(enhancementNotices.unit).toHaveLength(MAX_ENHANCEMENT_NOTICES_PER_UNIT);
        expect(orderEnhancementNoticesForDisplay(enhancementNotices.unit)[0].title).toBe("notice 9");
        const clickedId = enhancementNotices.unit?.[2].id;
        expect(clickedId).toBeDefined();
        uiActions.dismissEnhancementNotice("unit", clickedId);
        expect(enhancementNotices.unit?.some((notice) => notice.id === clickedId)).toBe(false);
        expect(enhancementNotices.unit).toHaveLength(MAX_ENHANCEMENT_NOTICES_PER_UNIT - 1);

        uiActions.showEnhancementNotice("unit", {
            feature: "Loom",
            title: "Loom",
            message: "offline",
        });
        uiActions.dismissEnhancementNoticesByFeature("unit", "Loom");
        expect(enhancementNotices.unit?.some((notice) => notice.feature === "Loom")).toBe(false);
        expect(enhancementNotices.unit?.length).toBe(MAX_ENHANCEMENT_NOTICES_PER_UNIT - 1);
    });
});
