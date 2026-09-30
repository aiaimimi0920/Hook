import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauriEvents = vi.hoisted(() => ({
    listeners: new Map<string, (event: { payload: unknown }) => void>(),
    listen: vi.fn(async (
        name: string,
        callback: (event: { payload: unknown }) => void,
    ) => {
        tauriEvents.listeners.set(name, callback);
        return () => tauriEvents.listeners.delete(name);
    }),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: tauriEvents.listen }));

import { AppListenerRegistry } from "../../src/services/appListenerRegistry";
import { registerAppPointerListeners } from "../../src/services/appPointerListeners";
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

const register = async (overlaySynthetic: OverlaySyntheticDispatcher) => {
    const registry = new AppListenerRegistry();
    const handleDragMove = vi.fn();
    await registerAppPointerListeners({
        registry,
        captureInput: {
            nativePointerActive: false,
            ctrlReleasedSinceCaptureStart: false,
        },
        overlaySynthetic,
        handleSelectionStart: vi.fn(),
        handleSelectionMove: vi.fn(),
        handleSelectionEnd: vi.fn(),
        abortCaptureSelection: vi.fn(async () => undefined),
        handleDragMove,
    });
    return { registry, handleDragMove };
};

describe("app pointer listener routing", () => {
    beforeEach(() => {
        tauriEvents.listeners.clear();
        tauriEvents.listen.mockClear();
        setDraggingStickerId(null);
    });

    afterEach(() => setDraggingStickerId(null));

    it("keeps native move samples in OCR selection while sticker drag state exists", async () => {
        const overlaySynthetic = dispatcher(true);
        const { registry, handleDragMove } = await register(overlaySynthetic);
        setDraggingStickerId("sticker-with-ocr");

        tauriEvents.listeners.get("overlay/global_mouse_move")?.({
            payload: { x: 40, y: 18, globalX: 140, globalY: 118 },
        });

        expect(overlaySynthetic.dispatch).toHaveBeenCalledWith("mousemove", {
            x: 40,
            y: 18,
            globalX: 140,
            globalY: 118,
        });
        expect(handleDragMove).not.toHaveBeenCalled();
        registry.dispose();
    });

    it("retains the fast sticker drag path outside text selection", async () => {
        const overlaySynthetic = dispatcher(false);
        const { registry, handleDragMove } = await register(overlaySynthetic);
        setDraggingStickerId("ordinary-sticker");

        tauriEvents.listeners.get("overlay/global_mouse_move")?.({
            payload: { x: 12, y: 24 },
        });

        expect(overlaySynthetic.dispatch).not.toHaveBeenCalled();
        expect(handleDragMove).toHaveBeenCalledTimes(1);
        registry.dispose();
    });
});
