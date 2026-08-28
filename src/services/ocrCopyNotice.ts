import { uiActions } from "../store/uiStore";
import { copyOcrTextToClipboard } from "./ocrOverlayInteraction";

const OCR_COPY_NOTICE_TEXT_LIMIT = 96;
export type OcrCopyScope = "block" | "full";

const summarizeCopiedOcrText = (text: string) => {
    const withoutControls = Array.from(text, (character) => {
        const code = character.charCodeAt(0);
        return code < 0x20 || (code >= 0x7f && code <= 0x9f) ? "" : character;
    }).join("");
    const compact = withoutControls
        .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    return compact.length > OCR_COPY_NOTICE_TEXT_LIMIT
        ? `${compact.slice(0, OCR_COPY_NOTICE_TEXT_LIMIT)}...`
        : compact;
};

/** Keeps automatic, full-result, and per-block copies on one unit-scoped notice path. */
export const showOcrCopyNotice = (
    unitId: string,
    text: string,
    copied: boolean,
    scope: OcrCopyScope = "block",
) => {
    const isFullCopy = scope === "full";
    uiActions.showEnhancementNotice(unitId, copied
        ? {
            feature: "OCR",
            title: isFullCopy ? "全部 OCR 文本已复制" : "OCR 文本已复制",
            message: `${isFullCopy ? "已复制全文" : "已复制文本"}：${summarizeCopiedOcrText(text)}`,
        }
        : {
            feature: "OCR",
            title: isFullCopy ? "全部 OCR 文本复制失败" : "OCR 文本复制失败",
            message: "系统剪贴板暂时不可用；识别结果仍保存在贴图中，请点击 OCR 文本重试。",
        });
};

export const copyOcrTextWithNotice = async (
    unitId: string,
    text: string,
    scope: OcrCopyScope = "block",
): Promise<boolean> => {
    const copied = await copyOcrTextToClipboard(text);
    showOcrCopyNotice(unitId, text, copied, scope);
    return copied;
};
