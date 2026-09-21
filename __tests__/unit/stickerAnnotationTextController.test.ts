import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStickerAnnotationTextController } from "../../src/components/stickerAnnotationTextController";
import { createEmptyAnnotationState } from "../../src/services/stickerEditing";

afterEach(() => {
    vi.useRealTimers();
});

const createController = () => {
    const refreshOverlayInteractivity = vi.fn(async () => undefined);
    const controller = createStickerAnnotationTextController({
        width: () => 640,
        height: () => 480,
        annotationState: () => createEmptyAnnotationState(),
        commitAnnotation: vi.fn(async () => undefined),
        patchUnitData: vi.fn(async () => undefined),
        rememberCurrentState: vi.fn(),
        refreshOverlayInteractivity,
    });
    return { controller, refreshOverlayInteractivity };
};

describe("sticker annotation text controller", () => {
    it("cancels the deferred input focus when its reactive owner is disposed", () => {
        vi.useFakeTimers();
        const focus = vi.fn();
        const select = vi.fn();

        createRoot((dispose) => {
            const { controller } = createController();
            controller.setPendingTextInputRef({ focus, select } as unknown as HTMLInputElement);
            controller.beginPendingTextInput({ x: 20, y: 30 });
            dispose();
        });

        vi.runAllTimers();
        expect(focus).not.toHaveBeenCalled();
        expect(select).not.toHaveBeenCalled();
    });

    it("keeps only the latest deferred focus request during rapid re-entry", () => {
        vi.useFakeTimers();
        const focus = vi.fn();
        const select = vi.fn();

        createRoot((dispose) => {
            const { controller } = createController();
            controller.setPendingTextInputRef({ focus, select } as unknown as HTMLInputElement);
            controller.beginPendingTextInput({ x: 20, y: 30 });
            controller.beginPendingTextInput({ x: 40, y: 50 });
            vi.runAllTimers();
            dispose();
        });

        expect(focus).toHaveBeenCalledTimes(1);
        expect(select).toHaveBeenCalledTimes(1);
    });

    it("refreshes native overlay interactivity after a committed text edit", async () => {
        const { controller, refreshOverlayInteractivity } = createController();
        controller.beginPendingTextInput({ x: 20, y: 30 });
        controller.setPendingTextInput((current) =>
            current ? { ...current, value: "hello" } : current,
        );

        await controller.commitPendingTextInput();

        expect(refreshOverlayInteractivity).toHaveBeenCalledTimes(1);
    });
});
