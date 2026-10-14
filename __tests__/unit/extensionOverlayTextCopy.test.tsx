// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { ExtensionUnitOverlayLayer } from "../../src/components/ExtensionUnitOverlayLayer";
import { api } from "../../src/services/api";
import { extensionCommandRouter } from "../../src/services/extensionCommandRouter";
import { uiActions } from "../../src/store/uiStore";
import type { Unit } from "../../src/types/unit";
import { supportsOverlayTextCopy } from "../../src/components/extensionOverlayTextCopy";

vi.mock("../../src/services/extensionVisualSources", () => ({ unitExtensionVisuals: (unit: Unit) =>
    unit.data.extensionState!.attachments.map((attachment) => ({ attachment, descriptor: {
        id: "text-overlay", scopeId: "text", pluginId: attachment.pluginId, pluginVersion: "1",
        bounds: { x: 0, y: 0, width: 100, height: 100 }, generation: 1,
    } })) }));
vi.mock("../../src/services/extensionVisualRegistry", () => ({ extensionVisualRegistry: {
    attachmentAvailable: () => true, rendererFor: () => ({}),
    sceneFor: () => ({ id: "root", type: "stack", children: [
        { id: "first", type: "text", props: { text: "第一块\nFirst", selectable: true } },
        { id: "second", type: "text", props: { text: "第二块", selectable: true } },
    ] }),
} }));
const unit = (plugin: string): Unit => ({ id: "text-copy", type: "sticker", x: 0, y: 0, w: 100, h: 100,
    params: {}, inputs: [], outputs: [], data: { extensionState: { schemaVersion: 1, revision: 1, attachments: [{
        attachmentId: `${plugin}.result`, typeId: `${plugin}.result.v1`, pluginId: plugin,
        pluginVersion: "1", schemaVersion: "1", revision: 1, resourceRefs: [],
    }] } } });
let dispose: (() => void) | undefined;
let host: HTMLDivElement;
const mount = (plugin = "neuro.official/ocr", parentDown = () => {}) => {
    host = document.createElement("div"); document.body.append(host);
    dispose = render(() => <div onMouseDown={parentDown}><ExtensionUnitOverlayLayer unit={unit(plugin)} isMinified={false}
        editorOwnsPointerInput={true} onActivate={() => undefined} /></div>, host);
    return [...host.querySelectorAll<HTMLElement>(".surface-text")];
};
afterEach(() => { window.getSelection()?.removeAllRanges(); dispose?.(); host?.remove(); vi.restoreAllMocks(); });
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe("OCR and translation block copy", () => {
    it.each(["neuro.official/ocr", "neuro.official/text-translation"])("copies only the clicked block for %s with the editor open", async (plugin) => {
        uiActions.setStickerEditMode("select");
        const write = vi.spyOn(api, "copyTextToClipboard").mockResolvedValue(true);
        const route = vi.spyOn(extensionCommandRouter, "execute").mockResolvedValue(null);
        const parentDown = vi.fn();
        const texts = mount(plugin, parentDown);
        const down = new MouseEvent("mousedown", { bubbles: true });
        texts[0].dispatchEvent(down); texts[0].click(); await settle();
        expect(write).toHaveBeenCalledExactlyOnceWith("第一块\nFirst");
        expect(parentDown).not.toHaveBeenCalled(); expect(route).not.toHaveBeenCalled();
        texts[1].click(); await settle(); expect(write).toHaveBeenLastCalledWith("第二块");
    });
    it("preserves text selection instead of copying the entire block on pointer-up", () => {
        uiActions.setStickerEditMode("select");
        const write = vi.spyOn(api, "copyTextToClipboard").mockResolvedValue(true);
        const texts = mount(); const range = document.createRange();
        range.selectNodeContents(texts[0]); window.getSelection()!.addRange(range);
        texts[0].click(); expect(write).not.toHaveBeenCalled();
    });
    it("does not copy while drawing or on empty overlay space", () => {
        uiActions.setStickerEditMode("brush");
        const write = vi.spyOn(api, "copyTextToClipboard").mockResolvedValue(true);
        const texts = mount(); texts[0].click();
        expect(host.querySelector("[data-editor-pointer-passthrough='true']")).not.toBeNull();
        uiActions.setStickerEditMode("select");
        host.querySelector<HTMLElement>(".surface-stack")!.click();
        expect(write).not.toHaveBeenCalled();
    });
    it("does not grant local copying to unrelated extension text", () => {
        expect(supportsOverlayTextCopy(unit("publisher/other").data.extensionState!.attachments[0])).toBe(false);
    });
});
