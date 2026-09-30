import { getCurrentAppSettings } from "./appSettings";
import { currentExtensionTarget, currentExtensionUnit } from "./extensionContext";
import type { ExtensionTarget } from "./extensionBridgeProtocol";
import type { UnitAttachment } from "../types/unitExtension";
import { DEFAULT_HOOK_GENERAL_SETTINGS } from "./hookGeneralSettings";

const OCR_PLUGIN = "neuro.official/ocr";
const OCR_TYPE = "neuro.official/ocr.result.v1";
const OCR_COMMAND = "neuro.official/ocr.recognize-selected-unit";
const MAX_TEXT_CHARS = 16_384;

const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const ocrAttachment = (): UnitAttachment | undefined => currentExtensionUnit()
    ?.data.extensionState?.attachments.find((item) => item.pluginId === OCR_PLUGIN
        && item.typeId === OCR_TYPE && item.schemaVersion === "1");

const imageIdentity = (): string => {
    const data = currentExtensionUnit()?.data;
    return JSON.stringify([data?.src, data?.filePath, data?.previewSrc]);
};

const boundedText = (value: unknown): string => {
    if (typeof value !== "string" || !value.trim() || [...value].length > MAX_TEXT_CHARS) {
        throw new Error("OCR text is empty or exceeds the translation limit");
    }
    return value;
};

const dimension = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 100_000) {
        throw new Error("OCR image dimensions are invalid");
    }
    return value;
};

const blocks = (value: unknown, width: number, height: number) => {
    if (!Array.isArray(value) || value.length > 128) throw new Error("OCR text blocks are invalid");
    return value.map((item) => {
        const block = record(item);
        const text = boundedText(block.text);
        const { left, top, width: w, height: h } = block;
        if ([left, top, w, h].some((v) => typeof v !== "number" || !Number.isFinite(v))
            || (left as number) < 0 || (top as number) < 0 || (w as number) <= 0 || (h as number) <= 0
            || (left as number) + (w as number) > width + 1 || (top as number) + (h as number) > height + 1) {
            throw new Error("OCR text block geometry is invalid");
        }
        const color = (v: unknown, fallback: string) =>
            typeof v === "string" && /^#[0-9a-f]{6}$/iu.test(v) ? v : fallback;
        return { text, left, top, width: w, height: h,
            textColor: color(block.textColor, "#ffffff"), backgroundColor: color(block.backgroundColor, "#111111") };
    });
};

/** The signed ocr-text.v1 context exports text/geometry only, not opaque foreign state or resources. */
export const prepareOcrTextCommandInput = async (
    target: ExtensionTarget,
    run: (commandId: string) => Promise<unknown>,
): Promise<{ input: unknown; assertCurrent: () => void }> => {
    const image = imageIdentity();
    const assertTarget = () => {
        const current = currentExtensionTarget();
        if (current?.unitId !== target.unitId || current.revision !== target.revision || imageIdentity() !== image) {
            throw new Error("translation source changed while preparing the command");
        }
    };
    assertTarget();
    let attachment = ocrAttachment();
    if (!attachment || !record(attachment.payload).fullText) {
        await run(OCR_COMMAND);
        assertTarget();
        attachment = ocrAttachment();
    }
    if (!attachment) throw new Error("OCR produced no text to translate");
    const payload = record(attachment.payload);
    const text = boundedText(payload.fullText);
    const width = dimension(payload.sourceWidth);
    const height = dimension(payload.sourceHeight);
    const sourceAttachment = { attachmentId: attachment.attachmentId, revision: attachment.revision,
        ...(attachment.payloadDigest ? { digest: attachment.payloadDigest } : {}) };
    const displayLanguage = globalThis.document?.documentElement.lang || DEFAULT_HOOK_GENERAL_SETTINGS.language;
    const targetLanguage = getCurrentAppSettings().translationTargetLanguage
        || (displayLanguage.toLowerCase().startsWith("zh") ? "zh-CN" : "en");
    const providerMode = getCurrentAppSettings().translationProviderMode;
    // `auto` is the protocol default. Omitting it keeps the signed input
    // compatible with older translation capabilities that predate this field.
    const providerInput = providerMode === "auto" ? {} : { providerMode };
    return {
        input: { text, targetLanguage, ...providerInput, sourceRevision: target.revision, sourceAttachment,
            sourceWidth: width, sourceHeight: height, textBlocks: blocks(payload.textBlocks, width, height) },
        assertCurrent: () => {
            assertTarget();
            const current = ocrAttachment();
            if (current?.attachmentId !== sourceAttachment.attachmentId
                || current.revision !== sourceAttachment.revision
                || current.payloadDigest !== sourceAttachment.digest
                || record(current.payload).fullText !== text) {
                throw new Error("OCR source changed while translating");
            }
        },
    };
};
