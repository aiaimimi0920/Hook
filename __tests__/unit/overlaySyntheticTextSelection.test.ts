// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { createOverlaySyntheticDispatcher } from "../../src/services/overlaySyntheticEvents";

const rect = (width: number, height: number): DOMRect => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
});

const installCaretResolver = (
    resolveNode: () => Node,
    offsetForX: (x: number) => number,
) => {
    const original = Object.getOwnPropertyDescriptor(document, "caretRangeFromPoint");
    Object.defineProperty(document, "caretRangeFromPoint", {
        configurable: true,
        value: (x: number) => {
            const range = document.createRange();
            const node = resolveNode();
            range.setStart(node, offsetForX(x));
            range.collapse(true);
            return range;
        },
    });
    return () => {
        if (original) Object.defineProperty(document, "caretRangeFromPoint", original);
        else Reflect.deleteProperty(document, "caretRangeFromPoint");
    };
};

const installCharacterRects = (target: Text, characterWidth = 10) => {
    const original = Range.prototype.getBoundingClientRect;
    Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
        if (this.startContainer !== target || this.endContainer !== target) return rect(0, 0);
        const left = this.startOffset * characterWidth;
        const right = this.endOffset * characterWidth;
        return {
            ...rect(right - left, 20),
            x: left,
            left,
            right,
        };
    };
    return () => { Range.prototype.getBoundingClientRect = original; };
};

const dispatcherFor = (target: Element) => createOverlaySyntheticDispatcher({
    doc: document,
    elementFromPoint: () => target,
    isLinking: () => false,
    getDraggingStickerId: () => null,
});

afterEach(() => {
    document.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
});

describe("overlay synthetic text selection", () => {
    it("selects a declarative text substring instead of firing its whole-block click", () => {
        const text = document.createTextNode("select me");
        const span = document.createElement("span");
        span.dataset.surfaceSelectableText = "true";
        span.append(text);
        span.getBoundingClientRect = () => rect(90, 20);
        document.body.append(span);
        let clicks = 0;
        span.addEventListener("click", () => { clicks += 1; });
        const restoreCaret = installCaretResolver(
            () => text,
            (x) => Math.min(Math.max(Math.floor(x / 10), 0), text.length),
        );
        try {
            const dispatcher = dispatcherFor(span);
            dispatcher.dispatch("mousedown", { x: 1, y: 10 });
            dispatcher.dispatch("mousemove", { x: 51, y: 10 });
            dispatcher.dispatch("mouseup", { x: 51, y: 10 });

            expect(document.getSelection()?.toString()).toBe("selec");
            expect(clicks).toBe(0);
        } finally {
            restoreCaret();
        }
    });

    it("keeps a selection-free text click as the block activation gesture", () => {
        const text = document.createTextNode("copy all");
        const span = document.createElement("span");
        span.dataset.surfaceSelectableText = "true";
        span.append(text);
        span.getBoundingClientRect = () => rect(80, 20);
        document.body.append(span);
        let clicks = 0;
        span.addEventListener("click", () => { clicks += 1; });
        const restoreCaret = installCaretResolver(() => text, () => 2);
        try {
            const dispatcher = dispatcherFor(span);
            dispatcher.dispatch("mousedown", { x: 20, y: 10 });
            dispatcher.dispatch("mouseup", { x: 20, y: 10 });
            expect(clicks).toBe(1);
        } finally {
            restoreCaret();
        }
    });

    it("maps a shielded textarea drag to selectionStart and selectionEnd", () => {
        const textarea = document.createElement("textarea");
        textarea.dataset.surfaceSelectableText = "true";
        textarea.value = "abcdef";
        textarea.scrollTop = 18;
        textarea.getBoundingClientRect = () => rect(120, 60);
        document.body.append(textarea);
        let clicks = 0;
        let observedMirrorScrollTop = -1;
        textarea.addEventListener("click", () => { clicks += 1; });
        const restoreCaret = installCaretResolver(
            () => {
                const mirror = document.querySelector<HTMLElement>(
                    "[data-overlay-synthetic-textarea-mirror='true']",
                );
                observedMirrorScrollTop = mirror?.scrollTop ?? -1;
                return mirror?.firstChild ?? document.createTextNode("");
            },
            (x) => Math.min(Math.max(Math.floor(x / 10), 0), textarea.value.length),
        );
        try {
            const dispatcher = dispatcherFor(textarea);
            dispatcher.dispatch("mousedown", { x: 11, y: 10 });
            expect(document.querySelector<HTMLElement>(
                "[data-overlay-synthetic-textarea-mirror='true']",
            )?.style.pointerEvents).toBe("none");
            expect(document.querySelector<HTMLElement>(
                "[data-overlay-synthetic-textarea-mirror='true']",
            )?.style.overflowY).toBe("hidden");
            dispatcher.dispatch("mousemove", { x: 51, y: 10 });
            dispatcher.dispatch("mouseup", { x: 51, y: 10 });

            expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([1, 5]);
            expect(observedMirrorScrollTop).toBe(18);
            expect(clicks).toBe(0);
            expect(document.querySelector("[data-overlay-synthetic-textarea-mirror]")).toBeNull();
        } finally {
            restoreCaret();
        }
    });

    it("manually scrolls a shielded textarea wheel sample", () => {
        const textarea = document.createElement("textarea");
        textarea.dataset.surfaceSelectableText = "true";
        Object.defineProperty(textarea, "clientHeight", { configurable: true, value: 20 });
        Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 100 });
        document.body.append(textarea);

        dispatcherFor(textarea).dispatch("wheel", { x: 5, y: 5, deltaY: 40 });

        expect(textarea.scrollTop).toBe(40);
    });

    it("resolves selectable descendants inside a direct declarative surface root", () => {
        const text = document.createTextNode("nested selectable text");
        const span = document.createElement("span");
        span.dataset.surfaceSelectableText = "true";
        span.append(text);
        span.getBoundingClientRect = () => rect(190, 20);
        const surface = document.createElement("div");
        surface.dataset.overlaySyntheticTarget = "direct";
        surface.getBoundingClientRect = () => rect(190, 20);
        surface.append(span);
        document.body.append(surface);
        let clicks = 0;
        span.addEventListener("click", () => { clicks += 1; });
        const restoreCaret = installCaretResolver(
            () => text,
            (x) => Math.min(Math.max(Math.floor(x / 10), 0), text.length),
        );
        try {
            const dispatcher = createOverlaySyntheticDispatcher({
                doc: document,
                elementFromPoint: () => surface,
                isLinking: () => false,
                getDraggingStickerId: () => null,
            });
            dispatcher.dispatch("mousedown", { x: 1, y: 10 });
            dispatcher.dispatch("mousemove", { x: 81, y: 10 });
            dispatcher.dispatch("mouseup", { x: 81, y: 10 });

            expect(document.getSelection()?.toString()).toBe("nested s");
            expect(clicks).toBe(0);
        } finally {
            restoreCaret();
        }
    });

    it("recovers selectable OCR text when native hit testing collapses to app-main", () => {
        const text = document.createTextNode("root fallback selection");
        const span = document.createElement("span");
        span.dataset.surfaceSelectableText = "true";
        span.append(text);
        span.getBoundingClientRect = () => rect(230, 20);
        const surface = document.createElement("div");
        surface.dataset.overlaySyntheticTarget = "direct";
        surface.append(span);
        surface.addEventListener("mousedown", (event) => event.stopPropagation());
        let stickerDragStarts = 0;
        const unit = document.createElement("div");
        unit.addEventListener("mousedown", () => { stickerDragStarts += 1; });
        unit.append(surface);
        const appMain = document.createElement("div");
        appMain.id = "app-main";
        appMain.append(unit);
        document.body.append(appMain);
        const restoreCaret = installCaretResolver(
            () => text,
            (x) => Math.min(Math.max(Math.floor(x / 10), 0), text.length),
        );
        try {
            const dispatcher = createOverlaySyntheticDispatcher({
                doc: document,
                elementFromPoint: () => appMain,
                isLinking: () => false,
                getDraggingStickerId: () => null,
            });
            dispatcher.dispatch("mousedown", { x: 1, y: 10 });
            expect(dispatcher.textSelectionActive).toBe(true);
            dispatcher.dispatch("mousemove", { x: 81, y: 10 });
            dispatcher.dispatch("mouseup", { x: 81, y: 10 });

            expect(document.getSelection()?.toString()).toBe("root fal");
            expect(stickerDragStarts).toBe(0);
        } finally {
            restoreCaret();
        }
    });

    it("gives recovered OCR text ownership before the unit can start dragging", () => {
        const text = document.createTextNode("select ordinary OCR text");
        const span = document.createElement("span");
        span.dataset.surfaceSelectableText = "true";
        span.append(text);
        span.getBoundingClientRect = () => rect(240, 20);
        const surface = document.createElement("div");
        surface.dataset.overlaySyntheticTarget = "direct";
        surface.append(span);
        surface.addEventListener("mousedown", (event) => event.stopPropagation());
        let stickerDragStarts = 0;
        let draggingStickerId: string | null = null;
        const unit = document.createElement("div");
        unit.addEventListener("mousedown", () => {
            stickerDragStarts += 1;
            draggingStickerId = "ocr-sticker";
        });
        unit.append(surface);
        const appMain = document.createElement("div");
        appMain.id = "app-main";
        appMain.append(unit);
        document.body.append(appMain);
        const underlying = document.createTextNode("underlying image label");
        document.body.append(underlying);
        const restoreCaret = installCaretResolver(() => underlying, () => 0);
        const restoreRects = installCharacterRects(text);
        try {
            const dispatcher = createOverlaySyntheticDispatcher({
                doc: document,
                // The native shield can report the unit even though OCR text is
                // geometrically under the pointer. Selection recovers the span.
                elementFromPoint: () => unit,
                isLinking: () => false,
                getDraggingStickerId: () => draggingStickerId,
            });
            dispatcher.dispatch("mousedown", { x: 11, y: 10 });
            expect(dispatcher.textSelectionActive).toBe(true);
            dispatcher.dispatch("mousemove", { x: 61, y: 10 });
            dispatcher.dispatch("mouseup", { x: 61, y: 10 });

            expect(document.getSelection()?.toString()).toBe("elect");
            expect(stickerDragStarts).toBe(0);
        } finally {
            restoreRects();
            restoreCaret();
        }
    });
});
