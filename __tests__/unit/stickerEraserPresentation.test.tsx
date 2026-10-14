// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
vi.mock("../../src/services/syncService", () => ({ syncService: { updateBackendRects: vi.fn().mockResolvedValue(undefined) } }));
import { StickerTopStripPropertyBar } from "../../src/components/StickerTopStripPropertyBar";
import { StickerAnnotationDraftOverlays } from "../../src/components/StickerAnnotationDraftOverlays";
import type { DraftLine } from "../../src/components/stickerAnnotationModel";
import { stickerToolSettings, uiActions } from "../../src/store/uiStore";

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; });
const host = () => { const element = document.createElement("div"); document.body.append(element); return element; };

describe("eraser properties and draft presentation", () => {
    it("uses compact size controls and an independent annotation-only toggle", () => {
        uiActions.patchStickerToolSettings({ contentEraserSize: 24, contentEraserOnlyAnnotations: false });
        const element = host();
        dispose = render(() => <StickerTopStripPropertyBar tool="content-eraser" unitId="eraser-preview" />, element);
        expect(element.querySelector(".otter-rectangle-properties")).not.toBeNull();
        expect(element.querySelectorAll(".rectangle-number .rectangle-number-icon path")).toHaveLength(3);
        const input = element.querySelector<HTMLInputElement>('input[aria-label="擦除大小"]')!;
        input.value = "999"; input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        expect(stickerToolSettings.contentEraserSize).toBe(96);
        element.querySelector<HTMLButtonElement>('[aria-label="减少擦除大小"]')!.click();
        expect(stickerToolSettings.contentEraserSize).toBe(95);
        const toggle = element.querySelector<HTMLButtonElement>('[aria-label="只擦标记"]')!;
        toggle.click(); expect(toggle.getAttribute("aria-pressed")).toBe("true");
        expect(stickerToolSettings.contentEraserSize).toBe(95);
        toggle.click(); expect(stickerToolSettings.contentEraserOnlyAnnotations).toBe(false);
    });

    it("never paints an eraser placeholder on press, drag or release, while line drafts remain visible", () => {
        const element = host();
        const [draft, setDraft] = createSignal<DraftLine | null>({ mode: "content-eraser", points: [{ x: 40, y: 60 }] });
        dispose = render(() => <svg><StickerAnnotationDraftOverlays draftLine={draft()} draftEffectMode={null}
            draftEffectPathData={() => ""} draftShapeRect={null} draftShapeMeasurement={null}
            draftLineMeasurement={null} stickerWidth={400} stickerHeight={300} /></svg>, element);
        expect(element.querySelector("path")).toBeNull();
        setDraft({ mode: "content-eraser", points: [{ x: 40, y: 60 }, { x: 100, y: 60 }] });
        expect(element.querySelector("path")).toBeNull();
        setDraft(null); expect(element.querySelector("path")).toBeNull();
        setDraft({ mode: "line", points: [{ x: 40, y: 60 }, { x: 100, y: 60 }] });
        expect(element.querySelector("path")).not.toBeNull();
    });
});
