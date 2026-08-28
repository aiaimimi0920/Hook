// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";

import { UnitEnhancementNotices } from "../../src/components/UnitEnhancementNotices";
import { UnitVisualOverlays } from "../../src/components/UnitVisualOverlays";
import { api } from "../../src/services/api";
import { createOcrOverlayRectId } from "../../src/services/ocrOverlayInteraction";
import { extraRects } from "../../src/services/uiRegistry";
import { enhancementNotices, uiActions } from "../../src/store/uiStore";
import type { Unit } from "../../src/types/unit";

const UNIT_ID = "ocr-copy-notice-unit";
const BLOCK_TEXT = "first OCR";
const SECOND_BLOCK_TEXT = "second OCR";

const unit: Unit = {
    id: UNIT_ID,
    type: "sticker",
    x: 40,
    y: 30,
    w: 240,
    h: 120,
    params: {},
    inputs: [],
    outputs: [],
    data: {
        src: "data:image/png;base64,AA==",
        hideOcr: false,
        ocrResult: {
            fullText: BLOCK_TEXT,
            width: 240,
            height: 120,
            textBlocks: [{
                text: BLOCK_TEXT,
                boxPoints: [
                    { x: 10, y: 12 },
                    { x: 90, y: 12 },
                    { x: 90, y: 32 },
                    { x: 10, y: 32 },
                ],
                boxScore: 1,
                textScore: 1,
                colorHex: "#ffffff",
                bgColorHex: "#000000",
            }, {
                text: SECOND_BLOCK_TEXT,
                boxPoints: [
                    { x: 150, y: 12 },
                    { x: 230, y: 12 },
                    { x: 230, y: 32 },
                    { x: 150, y: 32 },
                ],
                boxScore: 1,
                textScore: 1,
                colorHex: "#ffffff",
                bgColorHex: "#000000",
            }],
        },
    },
};

describe("OCR copy notice portal", () => {
    let dispose: (() => void) | undefined;
    let host: HTMLDivElement;
    let noticesLayer: HTMLDivElement;

    beforeEach(() => {
        host = document.createElement("div");
        noticesLayer = document.createElement("div");
        document.body.append(host, noticesLayer);
        uiActions.dismissEnhancementNotice(UNIT_ID);
        uiActions.clearOcrInteractiveUnit();
    });

    afterEach(() => {
        dispose?.();
        uiActions.dismissEnhancementNotice(UNIT_ID);
        uiActions.clearOcrInteractiveUnit(UNIT_ID);
        host.remove();
        noticesLayer.remove();
        vi.restoreAllMocks();
    });

    it("reactivates existing OCR controls and notifies for each copied block", async () => {
        const copyText = vi.spyOn(api, "copyTextToClipboard").mockResolvedValue(true);
        dispose = render(
            () => (
                <>
                    <UnitVisualOverlays
                        unit={unit}
                        isArt={false}
                        isMinified={false}
                        isSelected={true}
                        isCleanView={false}
                        minifiedAnnotationViewport={{ width: 240, height: 120, offsetX: 0, offsetY: 0 }}
                        displaySrc={unit.data.src!}
                        artErrorMessage=""
                    />
                    <UnitEnhancementNotices
                        unitId={UNIT_ID}
                        unitX={unit.x}
                        unitY={unit.y}
                        unitWidth={unit.w}
                        unitHeight={unit.h}
                        noticesLayer={noticesLayer}
                    />
                </>
            ),
            host,
        );

        const findOcrText = (text = BLOCK_TEXT) =>
            host.querySelector<HTMLElement>(`[title='${text}']`)?.parentElement;
        const initiallyRenderedText = findOcrText();
        const secondRenderedText = findOcrText(SECOND_BLOCK_TEXT);
        expect(initiallyRenderedText?.style.pointerEvents).toBe("none");
        expect(secondRenderedText?.style.pointerEvents).toBe("none");
        expect(initiallyRenderedText?.getAttribute("role")).toBeNull();

        // Ctrl+2 renders recognition results before it enables OCR interaction.
        // Existing For children must react without relying on a later remount.
        uiActions.setOcrInteractiveUnit(UNIT_ID);
        await vi.waitFor(() => {
            expect(findOcrText()).toBe(initiallyRenderedText);
            expect(findOcrText()?.style.pointerEvents).toBe("auto");
            expect(findOcrText()?.getAttribute("role")).toBe("button");
            expect(findOcrText()?.tabIndex).toBe(0);
            expect(extraRects().some((rect) => rect.id === createOcrOverlayRectId(UNIT_ID, 0))).toBe(true);
            expect(findOcrText(SECOND_BLOCK_TEXT)).toBe(secondRenderedText);
            expect(findOcrText(SECOND_BLOCK_TEXT)?.style.pointerEvents).toBe("auto");
            expect(extraRects().some((rect) => rect.id === createOcrOverlayRectId(UNIT_ID, 1))).toBe(true);
        });
        findOcrText()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));

        await vi.waitFor(() => {
            expect(copyText).toHaveBeenCalledWith(BLOCK_TEXT);
            expect(enhancementNotices[UNIT_ID]?.[0]?.title).toBe("OCR 文本已复制");
            expect(noticesLayer.querySelector("[data-hook-unit-notice-layer='true']")?.textContent)
                .toContain(`已复制文本：${BLOCK_TEXT}`);
        });

        findOcrText(SECOND_BLOCK_TEXT)!
            .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
        await vi.waitFor(() => {
            expect(copyText).toHaveBeenNthCalledWith(2, SECOND_BLOCK_TEXT);
            expect(enhancementNotices[UNIT_ID]?.some((notice) =>
                notice.message.includes(SECOND_BLOCK_TEXT),
            )).toBe(true);
        });

        uiActions.clearOcrInteractiveUnit(UNIT_ID);
        await vi.waitFor(() => {
            expect(findOcrText()?.style.pointerEvents).toBe("none");
            expect(findOcrText()?.getAttribute("role")).toBeNull();
            expect(extraRects().some((rect) => rect.id.startsWith(`OCR_TEXT_${UNIT_ID}_`))).toBe(false);
        });

        uiActions.setOcrInteractiveUnit(UNIT_ID);
        await vi.waitFor(() => {
            expect(findOcrText()).toBe(initiallyRenderedText);
            expect(findOcrText()?.style.pointerEvents).toBe("auto");
            expect(findOcrText(SECOND_BLOCK_TEXT)).toBe(secondRenderedText);
        });
        findOcrText()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
        await vi.waitFor(() => expect(copyText).toHaveBeenNthCalledWith(3, BLOCK_TEXT));
    });
});
