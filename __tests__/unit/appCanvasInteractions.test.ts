import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppCanvasInteractions } from "../../src/services/appCanvasInteractions";
import type { OverlaySyntheticDispatcher } from "../../src/services/overlaySyntheticEvents";
import { setDraggingStickerId } from "../../src/store/uiStore";

const dispatcher = (textSelectionActive: boolean): OverlaySyntheticDispatcher => ({
    dispatch: vi.fn(),
    relayPointerMove: vi.fn(),
    clearHover: vi.fn(),
    reset: vi.fn(),
    moveRelayActive: false,
    textSelectionActive,
});

const interactions = (overlaySynthetic: OverlaySyntheticDispatcher) => {
    const handleDragMove = vi.fn();
    return {
        handleDragMove,
        handlers: createAppCanvasInteractions({
            tauriRuntime: true,
            overlaySynthetic,
            checkDragModifier: vi.fn(() => false),
            handleDragMove,
            handleDragEnd: vi.fn(),
            handleSelectionStart: vi.fn(),
            handleSelectionMove: vi.fn(),
            handleSelectionEnd: vi.fn(),
            resetSelection: vi.fn(),
            startDrag: vi.fn(),
        }),
    };
};

describe("app canvas text-selection ownership", () => {
    afterEach(() => setDraggingStickerId(null));

    it("does not move a sticker when an OCR selection replay bubbles to app-main", () => {
        setDraggingStickerId("stale-sticker-drag");
        const { handlers, handleDragMove } = interactions(dispatcher(true));

        handlers.handleGlobalMouseMove(new MouseEvent("mousemove", {
            bubbles: true,
            clientX: 80,
            clientY: 32,
        }));

        expect(handleDragMove).not.toHaveBeenCalled();
    });

    it("retains ordinary synthetic sticker dragging outside OCR selection", () => {
        setDraggingStickerId("ordinary-sticker");
        const { handlers, handleDragMove } = interactions(dispatcher(false));

        handlers.handleGlobalMouseMove(new MouseEvent("mousemove", {
            bubbles: true,
            clientX: 80,
            clientY: 32,
        }));

        expect(handleDragMove).toHaveBeenCalledTimes(1);
    });
});
