import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStickerAnnotationTextController } from "../../src/components/stickerAnnotationTextController";
import { createEmptyAnnotationState } from "../../src/services/stickerEditing";

const disposers: (() => void)[] = [];
afterEach(() => {
    disposers.splice(0).forEach((dispose) => dispose());
    vi.restoreAllMocks();
});

const setup = (save: () => Promise<void> = async () => undefined) =>
    createRoot((dispose) => {
        disposers.push(dispose);
        const restoreTextCursor = vi.fn(async () => undefined);
        const refreshOverlayInteractivity = vi.fn(async () => undefined);
        const commitAnnotation = vi.fn(save);
        const controller = createStickerAnnotationTextController({
            width: () => 640,
            height: () => 480,
            annotationState: () => createEmptyAnnotationState(),
            commitAnnotation,
            patchUnitData: vi.fn(async () => undefined),
            rememberCurrentState: vi.fn(),
            restoreTextCursor,
            refreshOverlayInteractivity,
        });
        const begin = (value = "hello") => {
            controller.beginPendingTextInput({ x: 20, y: 30 });
            controller.setPendingTextInput((draft) => draft ? { ...draft, value } : draft);
        };
        return { controller, begin, dispose, restoreTextCursor, refreshOverlayInteractivity, commitAnnotation };
    });

const keyEvent = (key: string, isComposing = false, keyCode = 0) =>
    new KeyboardEvent("keydown", { key, isComposing, keyCode, cancelable: true }) as
        KeyboardEvent & { currentTarget: HTMLInputElement };

describe("text input cursor lifecycle", () => {
    it("restores before persistence finishes and again after the annotation is generated", async () => {
        let finishSave!: () => void;
        const saving = new Promise<void>((resolve) => { finishSave = resolve; });
        const { controller, begin, restoreTextCursor, refreshOverlayInteractivity } = setup(() => saving);
        begin();
        const commit = controller.commitPendingTextInput();
        expect(controller.pendingTextInput()).toBeNull();
        expect(restoreTextCursor).toHaveBeenCalledTimes(1);
        expect(refreshOverlayInteractivity).not.toHaveBeenCalled();
        finishSave();
        await commit;
        expect(restoreTextCursor).toHaveBeenCalledTimes(2);
        expect(refreshOverlayInteractivity).toHaveBeenCalledTimes(1);
    });

    it("deduplicates Enter followed by blur while saving", async () => {
        const { controller, begin, restoreTextCursor, commitAnnotation } = setup();
        begin();
        controller.handlePendingTextInputKeyDown(keyEvent("Enter"));
        await controller.commitPendingTextInput();
        await Promise.resolve();
        expect(commitAnnotation).toHaveBeenCalledTimes(1);
        expect(restoreTextCursor).toHaveBeenCalledTimes(2);
    });

    it.each(["escape", "external cancellation", "dispose"])("restores on %s without saving", (reason) => {
        const { controller, begin, dispose, restoreTextCursor, commitAnnotation } = setup();
        begin();
        if (reason === "escape") controller.handlePendingTextInputKeyDown(keyEvent("Escape"));
        else if (reason === "dispose") dispose();
        else controller.setPendingTextInput(null);
        expect(restoreTextCursor).toHaveBeenCalledTimes(1);
        expect(commitAnnotation).not.toHaveBeenCalled();
    });

    it.each([
        { name: "composing Enter", key: "Enter", composing: true, code: 0 },
        { name: "IME key code 229", key: "Enter", composing: false, code: 229 },
        { name: "composing Escape", key: "Escape", composing: true, code: 0 },
    ])(
        "does not end an IME composition on $name", ({ key, composing, code }) => {
            const event = keyEvent(key, composing, code);
            const { controller, begin, restoreTextCursor, commitAnnotation } = setup();
            begin("composition");
            controller.handlePendingTextInputKeyDown(event);
            expect(controller.pendingTextInput()?.value).toBe("composition");
            expect(event.defaultPrevented).toBe(false);
            expect(commitAnnotation).not.toHaveBeenCalled();
            expect(restoreTextCursor).not.toHaveBeenCalled();
        },
    );

    it("keeps a newer editor alive when an older save completes", async () => {
        let finishSave!: () => void;
        const saving = new Promise<void>((resolve) => { finishSave = resolve; });
        const { controller, begin, restoreTextCursor } = setup(() => saving);
        begin("first");
        const commit = controller.commitPendingTextInput();
        begin("second");
        finishSave();
        await commit;
        expect(controller.pendingTextInput()?.value).toBe("second");
        expect(restoreTextCursor).toHaveBeenCalledTimes(2);
    });

    it("still restores if refreshing native interactivity fails", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { controller, begin, restoreTextCursor, refreshOverlayInteractivity } = setup();
        refreshOverlayInteractivity.mockRejectedValueOnce(new Error("refresh failed"));
        begin();
        await controller.commitPendingTextInput();
        expect(restoreTextCursor).toHaveBeenCalledTimes(2);
    });
});
