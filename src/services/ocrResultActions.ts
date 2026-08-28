import type { Unit } from "../types/unit";
import { graphStore } from "../store/graphStore";
import { uiActions } from "../store/uiStore";
import { copyOcrTextWithNotice } from "./ocrCopyNotice";
import { resolveOcrOverlayBlocks } from "./ocrOverlayLayout";

const joinDisplayedOcrBlocks = (unit: Unit): string => {
    const result = unit.data.ocrResult;
    if (!result) return "";

    return resolveOcrOverlayBlocks(
        result.textBlocks,
        result.scaleFactor,
        (block) => unit.data.showTranslated && block.translatedText
            ? block.translatedText
            : block.text,
    )
        .map((block) => block.copyText.trim())
        .filter(Boolean)
        .join("\n");
};

/** Resolves cached full text in the same language currently shown by the OCR overlay. */
export const resolveCachedOcrFullText = (unit: Unit | null | undefined): string => {
    if (!unit?.data.ocrResult) return "";
    if (unit.data.showTranslated) {
        return joinDisplayedOcrBlocks(unit) || unit.data.ocrResult.fullText.trim();
    }
    return unit.data.ocrResult.fullText.trim() || joinDisplayedOcrBlocks(unit);
};

/** Copies only persisted OCR data; Ctrl+2 remains the sole force-recognition path. */
export const copyCachedOcrFullText = async (unitId: string): Promise<boolean> => {
    const unit = graphStore.units.find((candidate) => candidate.id === unitId);
    const text = resolveCachedOcrFullText(unit);
    if (!text) {
        uiActions.showEnhancementNotice(unitId, {
            feature: "OCR",
            title: "暂无可复制的 OCR 全文",
            message: "请先按 Ctrl+2 重新识别当前贴图。",
        });
        return false;
    }
    return copyOcrTextWithNotice(unitId, text, "full");
};
