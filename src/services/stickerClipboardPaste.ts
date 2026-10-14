// Commit explicit clipboard selections through the existing undo and edit-propagation boundaries.
import { graphStore } from "../store/graphStore";
import { selectionActions, stickerToolSettings, uiActions } from "../store/uiStore";
import type { StickerTextAnnotation } from "../types/stickerEditing";
import type { SystemClipboardEntry } from "./systemClipboardHistory";
import { captureStickerEditSnapshot } from "./stickerHistory";
import { getTextLineMetrics, measureTextWidth } from "./stickerTextGeometry";
import { syncService } from "./syncService";

export async function pasteSystemClipboardEntry(unitId: string, entry: SystemClipboardEntry, isCurrent: () => boolean) {
    const target = graphStore.units.find((unit) => unit.id === unitId && unit.type === "sticker");
    if (!target || !isCurrent()) return;
    if (entry.kind === "image") {
        if (!entry.content.startsWith("data:image/png;base64,")) throw new Error("Invalid clipboard image");
        const image = new Image();
        image.src = entry.content;
        await image.decode();
        if (!isCurrent() || !graphStore.units.some((unit) => unit.id === unitId)) return;
        const scale = Math.min(1, 600 / Math.max(image.naturalWidth, image.naturalHeight));
        const w = Math.max(1, image.naturalWidth * scale);
        const h = Math.max(1, image.naturalHeight * scale);
        const id = crypto.randomUUID();
        graphStore.actions.addUnit({ id, type: "sticker", x: target.x + (target.w - w) / 2,
            y: target.y + (target.h - h) / 2, w, h, params: {}, inputs: [], outputs: [],
            data: { src: entry.content, minified: false } });
        selectionActions.set([id]);
    } else {
        if (!entry.content.trim() || entry.content.length > 65536) return;
        const state = target.data.annotationState ?? { elements: [], serialCounter: 1 };
        const fontSize = stickerToolSettings.textSize;
        const fontFamily = stickerToolSettings.textFontFamily;
        const line = getTextLineMetrics(fontSize, fontFamily);
        const lines = entry.content.replace(/\r\n?/g, "\n").split("\n");
        if (lines.length > 256) throw new Error("Clipboard text has too many lines");
        // Existing text annotations are single-line; one element per line preserves line breaks.
        const centerX = (target.data.minified ? target.data.cropOffset?.x ?? 0 : 0) + target.w / 2;
        const centerY = (target.data.minified ? target.data.cropOffset?.y ?? 0 : 0) + target.h / 2;
        const z = Math.max(0, ...state.elements.map((element) => element.zIndex));
        const annotations = lines.map<StickerTextAnnotation>((text, index) => ({
            id: crypto.randomUUID(), type: "text", zIndex: z + index + 1, text, fontSize, fontFamily,
            x: centerX - measureTextWidth(text, fontSize, "500", fontFamily) / 2,
            y: centerY + (index - (lines.length - 1) / 2) * line.height + line.baselineOffset,
            style: { color: stickerToolSettings.textColor, width: stickerToolSettings.strokeWidth, opacity: 1 },
        })).filter((annotation) => annotation.text.length > 0);
        uiActions.pushStickerHistory(unitId, captureStickerEditSnapshot(target));
        graphStore.actions.updateStickerEditData(unitId, { annotationState: { ...state, elements: [...state.elements, ...annotations] } });
        graphStore.actions.propagateStickerEditsFrom(unitId);
    }
    await syncService.updateBackendRects();
    await syncService.performWorkflowSync();
}
