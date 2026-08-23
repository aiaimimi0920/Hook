import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
    readFileSync(resolve(process.cwd(), relativePath), "utf8");

const sourceBetween = (source: string, start: string, end: string) => {
    const startIndex = source.indexOf(start);
    expect(startIndex).toBeGreaterThanOrEqual(0);
    const endIndex = source.indexOf(end, startIndex + start.length);
    expect(endIndex).toBeGreaterThan(startIndex);
    return source.slice(startIndex, endIndex);
};

describe("Art Surface native interaction contract", () => {
    it("keeps Surface Art on the synthetic sticker-body route used for dragging and iframe relay", () => {
        const syncSource = readSource("src/services/syncService.ts");
        const rustSource = readSource("src-tauri/src/lib.rs");
        const syntheticClassification = sourceBetween(
            rustSource,
            "fn is_sticker_body_synthetic_rect",
            "fn should_overlay_window_ignore_cursor_events",
        );

        expect(syncSource).toContain('name: u.data.minified ? "MINI" : "FULL"');
        expect(syncSource).not.toContain("ART_SURFACE_INTERACTIVE");
        expect(syntheticClassification).toContain('rect.name == "MINI" || rect.name == "FULL"');
    });

    it("focuses the overlay for Surface controls and preserves modifier-wheel gestures across the iframe", () => {
        const unitViewSource = readSource("src/components/UnitView.tsx");
        const bootstrapSource = readSource("public/javascript-surface-bootstrap.js");
        const javascriptSurfaceSource = readSource("src/components/JavaScriptSurface.tsx");
        const overlaySyntheticSource = readSource("src/services/overlaySyntheticEvents.ts");
        const stickerAnnotationSource = readSource("src/components/StickerAnnotationLayer.tsx");

        expect(unitViewSource).toContain("return api.focusOverlayWindow();");
        expect(unitViewSource).toContain("onActivate={activateUnit}");
        expect(bootstrapSource).toContain('type: "host-wheel"');
        expect(bootstrapSource).toContain("(!event.ctrlKey && !event.altKey)");
        expect(javascriptSurfaceSource).toContain('message.type === "host-wheel"');
        expect(javascriptSurfaceSource).toContain('iframe.dispatchEvent(new WheelEvent("wheel"');
        expect(javascriptSurfaceSource).toContain('type: "restore-editable-focus"');
        expect(bootstrapSource).toContain('message.type === "restore-editable-focus"');
        expect(bootstrapSource).toContain("const isHostReservedShortcut = event.code === \"KeyE\"");
        expect(bootstrapSource).toContain('type: "host-drag-move"');
        expect(bootstrapSource).toContain('type: "host-drag-end"');
        expect(overlaySyntheticSource).toContain('if (type === "mousedown") frame.focus();');
        expect(javascriptSurfaceSource).toContain("data-javascript-surface-interactive=");
        expect(overlaySyntheticSource).toContain('frame.dataset.javascriptSurfaceInteractive === "false"');
        expect(overlaySyntheticSource).toContain('data-sticker-surface-pass-through');
        expect(stickerAnnotationSource).toContain('data-sticker-surface-pass-through={usesExistingNodeInteractions() ? "true" : "false"}');
    });

    it("keeps the Surface init listener alive until an init message is actually accepted", () => {
        const bootstrapSource = readSource("public/javascript-surface-bootstrap.js");
        const initListener = sourceBetween(
            bootstrapSource,
            "const onHostMessage = async (event) => {",
            'globalThis.addEventListener("message", onHostMessage);',
        );

        // `once: true` drops the listener when it is invoked, not when it succeeds, so one
        // stray message before init would burn the only chance and strand the Surface.
        expect(initListener).not.toContain("once: true");
        expect(bootstrapSource).toContain('globalThis.addEventListener("message", onHostMessage);');
        expect(initListener).toContain('globalThis.removeEventListener("message", onHostMessage);');
        expect(initListener).toContain("if (event.source !== globalThis.parent) return;");

        const ignoreIndex = initListener.indexOf('event.data?.type !== "surface:init"');
        const sourceCheckIndex = initListener.indexOf("event.source !== globalThis.parent");
        const removalIndex = initListener.indexOf("removeEventListener");
        expect(ignoreIndex).toBeGreaterThanOrEqual(0);
        expect(sourceCheckIndex).toBeGreaterThan(ignoreIndex);
        expect(removalIndex).toBeGreaterThan(sourceCheckIndex);
    });

    it("keeps Surface controls hit-testable before Ctrl+E while edit annotations opt back into pointer input", () => {
        const unitViewSource = readSource("src/components/UnitView.tsx");
        const stickerAnnotationSource = readSource("src/components/StickerAnnotationLayer.tsx");
        const annotationViewport = sourceBetween(
            unitViewSource,
            'class="sticker-annotation-layer-viewport absolute"',
            "<StickerAnnotationLayer",
        );

        expect(unitViewSource).toContain("interactive={!isMinified()}");
        expect(annotationViewport).toContain('"pointer-events": "none"');
        expect(stickerAnnotationSource).toContain(
            '"pointer-events": interactionEnabled() ? "auto" : "none"',
        );
    });
});
