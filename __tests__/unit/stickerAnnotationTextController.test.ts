import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStickerAnnotationTextController } from "../../src/components/stickerAnnotationTextController";
import { createEmptyAnnotationState } from "../../src/services/stickerEditing";

afterEach(() => {
    vi.useRealTimers();
});

const createController = () => createStickerAnnotationTextController({
    width: () => 640,
    height: () => 480,
    annotationState: () => createEmptyAnnotationState(),
    commitAnnotation: vi.fn(async () => undefined),
    patchUnitData: vi.fn(async () => undefined),
    rememberCurrentState: vi.fn(),
});

describe("sticker annotation text controller", () => {
    it("cancels the deferred input focus when its reactive owner is disposed", () => {
        vi.useFakeTimers();
        const focus = vi.fn();
        const select = vi.fn();

        createRoot((dispose) => {
            const controller = createController();
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
            const controller = createController();
            controller.setPendingTextInputRef({ focus, select } as unknown as HTMLInputElement);
            controller.beginPendingTextInput({ x: 20, y: 30 });
            controller.beginPendingTextInput({ x: 40, y: 50 });
            vi.runAllTimers();
            dispose();
        });

        expect(focus).toHaveBeenCalledTimes(1);
        expect(select).toHaveBeenCalledTimes(1);
    });
});
