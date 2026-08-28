import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("enhancement unavailable notice contract", () => {
    const unitActionsSource = readSource("src/hooks/useUnitActions.ts");
    const unitOverlaysSource = readSource("src/components/UnitVisualOverlays.tsx");
    const unitNoticesSource = readSource("src/components/UnitEnhancementNotices.tsx");
    const canvasLayersSource = readSource("src/components/CanvasOverlayLayers.tsx");
    const unitViewSource = readSource("src/components/UnitView.tsx");
    const appSource = readSource("src/app.tsx");
    const uiStoreSource = readSource("src/store/uiStore.ts");
    const noticeQueueSource = readSource("src/services/enhancementNoticeQueue.ts");

    it("does not use native alert for missing OCR or translation enhancements because Hook click-through blocks it", () => {
        expect(unitActionsSource).not.toContain("window.alert");
        expect(unitActionsSource).not.toContain(".alert(");
        expect(unitActionsSource).toContain("uiActions.showEnhancementNotice");
        expect(noticeQueueSource).toContain('"Loom"');
    });

    it("renders a unit-bound, clickable notice above sibling unit stacking contexts", () => {
        expect(uiStoreSource).toContain("enhancementNotices");
        expect(uiStoreSource).toContain("showEnhancementNotice");
        expect(uiStoreSource).toContain("dismissEnhancementNotice");
        expect(uiStoreSource).toContain("dismissEnhancementNoticesByFeature");

        expect(unitNoticesSource).toContain("enhancementNotices");
        expect(unitNoticesSource).toContain("enhancement-notice");
        expect(unitNoticesSource).toContain("uiActions.dismissEnhancementNotice(props.unitId, notice.id)");
        expect(unitNoticesSource).toContain("event.stopPropagation()");
        expect(unitNoticesSource).toContain("ENHANCEMENT_NOTICE_TIMEOUT_MS");
        expect(unitNoticesSource).toContain("window.setTimeout");
        expect(unitNoticesSource).toContain("hook-enhancement-notice-stack");
        expect(unitNoticesSource).toContain("orderEnhancementNoticesForDisplay");
        expect(unitNoticesSource).toContain("stackElement.scrollTop = 0");
        expect(unitNoticesSource).toContain("role=\"button\"");
        expect(unitNoticesSource).toContain('data-hook-unit-notice-layer="true"');
        expect(unitNoticesSource).toContain("<Portal mount={props.noticesLayer!}>");
        expect(unitNoticesSource).toContain("registerDragFollowerElement");
        expect(unitViewSource).toContain("<UnitEnhancementNotices");
        expect(unitViewSource).toContain("noticesLayer={props.noticesLayer}");
        expect(appSource).toContain("createSignal<CanvasOverlayLayerRefs>({})");
        expect(appSource).toContain("<CanvasOverlayLayers onLayersChange={setCanvasOverlayLayers} />");
        expect(appSource).toContain("noticesLayerRef={canvasOverlayLayers().notices}");
        expect(canvasLayersSource).toContain('id="unit-notices-layer"');
        expect(canvasLayersSource).toContain("z-[2000000]");
        expect(unitOverlaysSource).not.toContain("hook-enhancement-notice-stack");
        expect(unitOverlaysSource).toContain("charCodeAt(0)");
        expect(unitOverlaysSource).toContain("message: `已复制文本：${summarizeCopiedOcrText(text)}`");
        expect(noticeQueueSource).toContain("MAX_ENHANCEMENT_NOTICES_PER_UNIT");
        expect(noticeQueueSource).toContain("appendEnhancementNotice");
    });

    it("surfaces Shift+1 Loom handshake failures in the selected sticker", () => {
        const shortcutSource = readSource("src/hooks/useAppShortcutController.ts");

        expect(shortcutSource).toContain("refreshActionsCapabilities");
        expect(shortcutSource).toContain("add-art-capability-refresh-failed");
        expect(shortcutSource).toContain('feature: "Loom"');
        expect(shortcutSource).toContain("uiActions.closeActions(unitId)");
        expect(shortcutSource).toContain("无法连接 Loom Hook");
    });
});
