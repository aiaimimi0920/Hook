// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupOverlaySyntheticHarness, type Harness } from "./overlaySyntheticTestHarness";

let h: Harness;
beforeEach(() => {
    h = setupOverlaySyntheticHarness();
});
afterEach(() => {
    document.body.innerHTML = "";
});

describe("overlay synthetic events: Art Surface pass-through", () => {
    it("lets blank Art overlay hits reach the live Surface while preserving annotation hits", () => {
        const visual = document.createElement("div");
        visual.className = "sticker-visual";
        const presentation = document.createElement("div");
        presentation.className = "art-surface-presentation";
        const frame = document.createElement("iframe");
        frame.dataset.javascriptSurfaceFrame = "true";
        frame.style.pointerEvents = "auto";
        Object.defineProperty(frame, "getBoundingClientRect", {
            configurable: true,
            value: () => ({
                left: 0,
                top: 0,
                right: 200,
                bottom: 200,
                width: 200,
                height: 200,
            } as DOMRect),
        });
        presentation.append(frame);

        const annotationViewport = document.createElement("div");
        const annotationRoot = document.createElement("div");
        annotationRoot.dataset.stickerInteractionRoot = "true";
        annotationRoot.dataset.stickerSurfacePassThrough = "true";
        let annotationMouseDowns = 0;
        annotationRoot.addEventListener("mousedown", () => {
            annotationMouseDowns += 1;
        });
        annotationViewport.append(annotationRoot);
        visual.append(presentation, annotationViewport);
        document.body.append(visual);

        const received: string[] = [];
        frame.addEventListener("hook:javascript-surface-pointer", (event) => {
            received.push((event as CustomEvent).detail.type);
        });
        h.setHit(() => annotationRoot);
        h.d.dispatch("mousedown", { x: 50, y: 60 });
        h.d.dispatch("mouseup", { x: 50, y: 60 });

        expect(received).toEqual(["mousedown", "mouseup"]);
        expect(annotationMouseDowns).toBe(0);

        const annotation = document.createElementNS("http://www.w3.org/2000/svg", "g");
        annotation.dataset.stickerAnnotationId = "annotation-1";
        annotationRoot.append(annotation);
        received.length = 0;
        h.setHit(() => annotation);
        h.d.dispatch("mousedown", { x: 50, y: 60 });
        h.d.dispatch("mouseup", { x: 50, y: 60 });

        expect(received).toEqual([]);
        expect(annotationMouseDowns).toBe(1);

        annotationRoot.dataset.stickerSurfacePassThrough = "false";
        received.length = 0;
        h.setHit(() => annotationRoot);
        h.d.dispatch("mousedown", { x: 50, y: 60 });
        h.d.dispatch("mouseup", { x: 50, y: 60 });
        expect(received).toEqual([]);
        expect(annotationMouseDowns).toBe(2);
    });

    it("resolves a declarative Surface control behind the Art annotation overlay", () => {
        const visual = document.createElement("div");
        visual.className = "sticker-visual";
        const presentation = document.createElement("div");
        presentation.className = "art-surface-presentation";
        Object.defineProperty(presentation, "getBoundingClientRect", {
            configurable: true,
            value: () => ({ left: 0, top: 0, right: 240, bottom: 240, width: 240, height: 240 } as DOMRect),
        });
        const declarative = document.createElement("div");
        declarative.className = "declarative-surface";
        const button = document.createElement("button");
        button.dataset.surfaceNodeId = "refresh";
        Object.defineProperty(button, "getBoundingClientRect", {
            configurable: true,
            value: () => ({ left: 20, top: 20, right: 120, bottom: 60, width: 100, height: 40 } as DOMRect),
        });
        declarative.append(button);
        presentation.append(declarative);
        const annotationRoot = document.createElement("div");
        annotationRoot.dataset.stickerInteractionRoot = "true";
        annotationRoot.dataset.stickerSurfacePassThrough = "true";
        visual.append(presentation, annotationRoot);
        document.body.append(visual);

        let clicks = 0;
        button.addEventListener("click", () => {
            clicks += 1;
        });
        h.setHit(() => annotationRoot);
        h.d.dispatch("mousedown", { x: 40, y: 40 });
        h.d.dispatch("mouseup", { x: 40, y: 40 });

        expect(clicks).toBe(1);
    });

});
