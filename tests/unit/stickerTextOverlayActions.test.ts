import { afterEach, describe, expect, it, vi } from "vitest";
import { graphStore } from "../../src/features/workspace/state/graphStore";
import { setSelectedStickerId } from "../../src/features/workspace/state/uiStore";
import { extensionCommandRouter } from "../../src/features/extensions/services/extensionCommandRouter";
import { applyExtensionPresentationSnapshot, extensionPresentationStore } from "../../src/features/extensions/services/extensionPresentationStore";
import { parseContributionSnapshot } from "../../src/features/extensions/services/extensionProtocol";
import { stickerTextOverlayActions, textOverlayAvailable, toggleStickerTextOverlay } from "../../src/features/stickers/services/stickerTextOverlayActions";
import { visibleStickerExtensionToolbarSlots } from "../../src/features/stickers/services/stickerExtensionToolbar";

const pluginId = "neuro.official/text-translation";
const action = stickerTextOverlayActions[1];
const setup = (commands = ["toggle-overlay", "toggle", "translate"]) => {
    graphStore.actions.addUnit({ id: "overlay-test", type: "sticker", x: 0, y: 0, w: 100, h: 100,
        data: { src: "data:image/png;base64,AA==" }, params: {}, inputs: [], outputs: [] });
    setSelectedStickerId("overlay-test");
    applyExtensionPresentationSnapshot(parseContributionSnapshot({
        protocol: "loom.extension.v1", apiVersion: "1.0", generation: 1,
        plugins: [{ id: pluginId, version: "0.2.35", packageDigest: "a".repeat(64), trustStatus: "trusted",
            permissionGrantDigest: "b".repeat(64), scopeId: "translation" }],
        contributions: { commands: commands.map((id) => ({ id: `${pluginId}.${id}`, pluginId, scopeId: "translation",
            when: id === "toggle-overlay" ? "unit.kind == 'sticker' && attachment.has('neuro.official/text-translation.result.v1')"
                : id === "translate" ? "unit.kind == 'sticker' && attachment.has('neuro.official/ocr.result.v1')"
                    : "unit.kind == 'sticker' && unit.hasImage" })),
            menus: [], shortcuts: [], settings: [], dataTypes: [], renderers: [], unitOverlays: [], backgroundTasks: [],
            resourceProviders: [], diagnostics: [], eventSubscriptions: [] },
    }));
    return vi.spyOn(extensionCommandRouter, "execute").mockResolvedValue(null);
};
const addResult = (owner: string) => graphStore.actions.updateUnitData("overlay-test", {
    extensionState: { schemaVersion: 1, revision: 1, attachments: [{ attachmentId: `${owner}.result`,
        typeId: `${owner}.result.v1`, pluginId: owner, pluginVersion: "1", schemaVersion: "1", revision: 1, resourceRefs: [] }] },
});
afterEach(() => {
    graphStore.actions.removeUnit("overlay-test"); setSelectedStickerId(null);
    applyExtensionPresentationSnapshot(null); vi.restoreAllMocks();
});

describe("primary OCR and translation toolbar actions", () => {
    it("uses the installed first-run command when the result-only toggle is disabled", async () => {
        const execute = setup();
        expect(textOverlayAvailable("overlay-test", action)).toBe(true);
        await toggleStickerTextOverlay("overlay-test", action);
        expect(execute).toHaveBeenCalledWith(`${pluginId}.toggle`);
    });
    it("prefers visibility toggling once translation exists", async () => {
        const execute = setup(); addResult(pluginId);
        await toggleStickerTextOverlay("overlay-test", action);
        expect(execute).toHaveBeenCalledWith(`${pluginId}.toggle-overlay`);
    });
    it("supports translate-only capabilities after OCR without bypassing their prerequisites", async () => {
        const execute = setup(["translate"]);
        expect(textOverlayAvailable("overlay-test", action)).toBe(false);
        addResult("neuro.official/ocr");
        expect(textOverlayAvailable("overlay-test", action)).toBe(true);
        await toggleStickerTextOverlay("overlay-test", action);
        expect(execute).toHaveBeenCalledWith(`${pluginId}.translate`);
    });
    it("rejects a different target or disconnected capabilities", async () => {
        const execute = setup();
        expect(textOverlayAvailable("other", action)).toBe(false);
        await expect(toggleStickerTextOverlay("other", action)).rejects.toThrow("unavailable");
        applyExtensionPresentationSnapshot(null);
        expect(textOverlayAvailable("overlay-test", action)).toBe(false);
        expect(execute).not.toHaveBeenCalled();
    });
    it("omits the duplicate official OCR slot but retains unrelated extensions", () => {
        setup();
        const item = extensionPresentationStore.paletteItems()[0];
        const items = [{ ...item, pluginId: "neuro.official/ocr", visible: () => true },
            { ...item, pluginId: "publisher/other", visible: () => true }];
        expect(visibleStickerExtensionToolbarSlots(items).map((slot) => slot.items[0].pluginId))
            .toEqual(["publisher/other"]);
    });
});
