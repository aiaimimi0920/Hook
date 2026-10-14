// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import { StickerSettingsExtras } from "../../src/components/StickerSettingsExtras";
import { stickerExtraText } from "../../src/services/stickerExtraText";
import { api } from "../../src/services/api";
import type { Unit } from "../../src/types/unit";
import type { UnitAttachment } from "../../src/types/unitExtension";

const attachment = (kind: string, payload: unknown): UnitAttachment => ({
    attachmentId: `neuro.official/${kind}.result`, typeId: `neuro.official/${kind}.result.v1`,
    pluginId: `neuro.official/${kind}`, schemaVersion: "1", revision: 1, pluginVersion: "1", resourceRefs: [],
    overlayVisible: false, payload,
});
const makeUnit = (): Unit => ({
    id: "copy-unit", type: "sticker", x: 0, y: 0, w: 100, h: 100, params: {}, inputs: [], outputs: [],
    data: { extensionState: { schemaVersion: 1, revision: 1, attachments: [
        attachment("ocr", { fullText: "原文一\n原文二" }),
        attachment("text-translation", { text: "First line\nSecond line", originalText: "原文一\n原文二",
            sourceRevision: 0, sourceAttachment: { attachmentId: "neuro.official/ocr.result", revision: 1 } }),
    ] } },
});
let dispose: (() => void) | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => { dispose?.(); host?.remove(); vi.restoreAllMocks(); });
const button = (label: string) => host!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const mount = (unit: () => Unit | undefined) => {
    host = document.createElement("div"); document.body.append(host);
    dispose = render(() => <StickerSettingsExtras unit={unit()} />, host);
};
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe("extra container text copying", () => {
    it("distinguishes source and translated text using short labels, separate icons and full tooltips", () => {
        mount(makeUnit);
        const original = button("复制 OCR 全文"), translated = button("复制翻译全文");
        expect(original.textContent).toBe("原文");
        expect(translated.textContent).toBe("译文");
        expect(original.title).toBe("复制 OCR 全文");
        expect(translated.title).toBe("复制翻译全文");
        expect(original.querySelector("path")?.getAttribute("d")).not.toBe(translated.querySelector("path")?.getAttribute("d"));
    });
    it("copies complete cached source and translation even when their overlays are hidden", async () => {
        const write = vi.spyOn(api, "copyTextToClipboard").mockResolvedValue(true);
        mount(makeUnit);
        button("复制 OCR 全文").click(); await settle();
        expect(write).toHaveBeenLastCalledWith("原文一\n原文二");
        expect(button("复制 OCR 全文").textContent).toContain("已复制");
        expect(button("复制 OCR 全文").querySelector("svg")).toBeNull();
        button("复制翻译全文").click(); await settle();
        expect(write).toHaveBeenLastCalledWith("First line\nSecond line");
    });
    it("disables missing or stale results without overwriting the clipboard", () => {
        const write = vi.spyOn(api, "copyTextToClipboard").mockResolvedValue(true);
        const [unit, setUnit] = createSignal<Unit>(); mount(unit);
        expect(button("复制 OCR 全文").disabled).toBe(true);
        expect(button("复制翻译全文").disabled).toBe(true);
        const stale = makeUnit(); stale.data.extensionState!.attachments[0].revision = 2; setUnit(stale);
        expect(button("复制 OCR 全文").disabled).toBe(false);
        expect(button("复制翻译全文").disabled).toBe(true);
        button("复制翻译全文").click(); expect(write).not.toHaveBeenCalled();
    });
    it("reports a denied clipboard write and allows retry", async () => {
        vi.spyOn(api, "copyTextToClipboard").mockResolvedValue(false);
        mount(makeUnit); button("复制 OCR 全文").click(); await settle();
        expect(button("复制 OCR 全文").textContent).toContain("复制失败");
        expect(button("复制 OCR 全文").querySelector("svg")).toBeNull();
        expect(button("复制 OCR 全文").disabled).toBe(false);
    });
    it("preserves whitespace and supports legacy text without falling back from an invalid current attachment", () => {
        const unit = makeUnit(); unit.data.ocrResult = { fullText: " legacy\n", textBlocks: [] };
        expect(stickerExtraText(unit, "ocr")).toBe("原文一\n原文二");
        unit.data.extensionState!.attachments[0].payload = { fullText: "  " };
        expect(stickerExtraText(unit, "ocr")).toBe("");
        unit.data.extensionState = undefined;
        expect(stickerExtraText(unit, "ocr")).toBe(" legacy\n");
        unit.data.translationResult = { fullText: "translated\n", sourceRevision: 0, targetLanguage: "en", textBlocks: [] };
        expect(stickerExtraText(unit, "translation")).toBe("translated\n");
    });
});
