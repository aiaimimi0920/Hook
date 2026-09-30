import { afterEach, describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import { ExtensionUnitOverlayLayer } from "../../src/components/ExtensionUnitOverlayLayer";
import { applyExtensionVisualSnapshot } from "../../src/services/extensionVisualRegistry";
import { unitExtensionVisuals } from "../../src/services/extensionVisualSources";
import type { UnitAttachment } from "../../src/types/unitExtension";
import { ocrAttachment, scene, translationSnapshot, translationUnit, translator } from "../fixtures/translation";

const translated = (): UnitAttachment => ({
    ...ocrAttachment(), attachmentId: `${translator}.result`, typeId: `${translator}.result.v1`, pluginId: translator,
    payload: { sourceRevision: 4, originalText: "Open project settings",
        sourceAttachment: { attachmentId: "neuro.official/ocr.result", revision: 3, digest: "c".repeat(64) },
        surfaceScene: scene("Translated project settings") },
});

const unitWithVisibility = (translationVisible: boolean, ocrVisible: boolean) => {
    const unit = translationUnit();
    const attachments = unit.data.extensionState!.attachments;
    attachments[0].payload = { ...(attachments[0].payload as Record<string, unknown>), visible: ocrVisible };
    const translation = translated();
    translation.payload = { ...(translation.payload as Record<string, unknown>), visible: translationVisible };
    attachments.push(translation);
    return unit;
};

describe("translation rendering", () => {
    let dispose: (() => void) | undefined;
    let container: HTMLDivElement | undefined;
    afterEach(() => { dispose?.(); container?.remove(); applyExtensionVisualSnapshot(null); });

    it("falls back from translation to OCR or the source image as visibility changes", () => {
        applyExtensionVisualSnapshot(translationSnapshot());
        const [unit, setUnit] = createSignal(unitWithVisibility(true, true));
        container = document.createElement("div");
        document.body.appendChild(container);
        dispose = render(() => <ExtensionUnitOverlayLayer unit={unit()} isMinified={false} editorOwnsPointerInput={false} onActivate={() => {}} />, container);
        expect(container.textContent).toContain("Translated project settings");
        expect(container.textContent).not.toContain("Open project settings");

        setUnit(unitWithVisibility(false, true));
        expect(container.textContent).toContain("Open project settings");
        expect(container.textContent).not.toContain("Translated project settings");

        setUnit(unitWithVisibility(false, false));
        expect(unitExtensionVisuals(unit())).toHaveLength(0);
        expect(container.textContent).not.toContain("Translated project settings");
        expect(container.textContent).not.toContain("Open project settings");

        setUnit(unitWithVisibility(true, false));
        expect(container.textContent).toContain("Translated project settings");
        expect(container.textContent).not.toContain("Open project settings");
    });

    it("does not show an unavailable placeholder when OCR uses its validated fallback renderer", () => {
        const snapshot = translationSnapshot();
        applyExtensionVisualSnapshot({
            ...snapshot,
            contributions: {
                ...snapshot.contributions,
                renderers: snapshot.contributions.renderers.filter((item) => item.pluginId !== "neuro.official/ocr"),
            },
        });
        const unit = unitWithVisibility(false, true);
        container = document.createElement("div");
        document.body.appendChild(container);
        dispose = render(() => <ExtensionUnitOverlayLayer unit={unit} isMinified={false} editorOwnsPointerInput={false} onActivate={() => {}} />, container);
        expect(container.textContent).toContain("Open project settings");
        expect(container.textContent).not.toContain("扩展视图不可用");
        expect(container.textContent).not.toContain("扩展数据不可用");
    });

    it.each(["target", "source", "digest"])("hides stale translation after %s changes", (change) => {
        applyExtensionVisualSnapshot(translationSnapshot());
        const unit = translationUnit();
        unit.data.extensionState!.attachments.push(translated());
        if (change === "target") unit.data.stickerEditPropagation = { revision: 5 };
        if (change === "source") unit.data.extensionState!.attachments[0].revision += 1;
        if (change === "digest") unit.data.extensionState!.attachments[0].payloadDigest = "d".repeat(64);
        expect(unitExtensionVisuals(unit).map(({ attachment }) => attachment.pluginId)).toEqual(["neuro.official/ocr"]);
    });

});
