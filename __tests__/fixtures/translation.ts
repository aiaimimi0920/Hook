import { parseContributionSnapshot } from "../../src/services/extensionProtocol";
import type { ExtensionResult } from "../../src/services/extensionBridgeProtocol";
import type { Unit } from "../../src/types/unit";
import type { UnitAttachment } from "../../src/types/unitExtension";

// A third-party ID verifies that the host uses the declared context contract.
export const translator = "publisher.example/translation";
export const toggleCommand = `${translator}.toggle`;
export const ocrCommand = "neuro.official/ocr.recognize-selected-unit";
export const scene = (text: string) => ({ id: "text", type: "text", props: { text } });
export const ocrAttachment = (): UnitAttachment => ({
    attachmentId: "neuro.official/ocr.result", typeId: "neuro.official/ocr.result.v1",
    pluginId: "neuro.official/ocr", pluginVersion: "1.0.0", schemaVersion: "1", revision: 3,
    payloadDigest: "c".repeat(64), resourceRefs: [],
    payload: { fullText: "Open project settings", sourceWidth: 100, sourceHeight: 80,
        textBlocks: [{ text: "Open project settings", left: 0, top: 0, width: 100, height: 30,
            textColor: "#111111", backgroundColor: "#ffffff" }],
        surfaceScene: scene("Open project settings"), secretField: "never exported" },
});

export const translationUnit = (withOcr = true): Unit => ({
    id: "translation-unit", type: "sticker", x: 0, y: 0, w: 100, h: 80,
    data: { src: "data:image/png;base64,iVBORw0KGgo=", stickerEditPropagation: { revision: 4 },
        extensionState: { schemaVersion: 1, revision: 1, attachments: withOcr ? [ocrAttachment()] : [] } },
    params: {}, inputs: [], outputs: [],
});

export const translationSnapshot = (translationPlugin = translator) => {
    const plugins = ["neuro.official/ocr", translationPlugin].map((id) => ({ id, version: "1.0.0",
        packageDigest: "a".repeat(64), trustStatus: "trusted", permissionGrantDigest: "b".repeat(64), scopeId: `${id}-scope` }));
    const contribution = (pluginId: string, id: string, extra: Record<string, unknown> = {}) =>
        ({ id, pluginId, scopeId: `${pluginId}-scope`, ...extra });
    return parseContributionSnapshot({ protocol: "loom.extension.v1", apiVersion: "1.0", generation: 1, plugins,
        contributions: {
            commands: [
                ...["toggle", "translate"].map((name) => contribution(translationPlugin, `${translationPlugin}.${name}`, {
                    commandId: `${translationPlugin}.${name}`, payload: {
                        inputContext: "ocr-text.v1", requiresUserGesture: true,
                        permissions: ["hook.unit.attachments.read", "hook.unit.attachments.write"],
                    },
                })),
                contribution(translationPlugin, `${translationPlugin}.toggle-overlay`, { commandId: `${translationPlugin}.toggle-overlay`, payload: {
                    permissions: ["hook.unit.attachments.read", "hook.unit.attachments.write"],
                } }),
                contribution("neuro.official/ocr", ocrCommand, { commandId: ocrCommand, payload: {
                    permissions: ["hook.unit.image.read", "hook.unit.attachments.read", "hook.unit.attachments.write"],
                } }),
                contribution("neuro.official/ocr", "neuro.official/ocr.toggle-overlay", {
                    commandId: "neuro.official/ocr.toggle-overlay", payload: {
                        permissions: ["hook.unit.attachments.read", "hook.unit.attachments.write"],
                    },
                }),
            ],
            dataTypes: plugins.map(({ id }) => contribution(id, `${id}.result.v1`)),
            renderers: plugins.map(({ id }) => contribution(id, `${id}.renderer`, { payload: { schema: "renderer.v1", payload: {
                typeId: `${id}.result.v1`, bounds: { x: 0, y: 0, width: 8192, height: 8192 }, attachmentScenePath: "/surfaceScene",
                ...(id === translationPlugin ? { sourceContext: "ocr-text.v1", replacesSource: true } : {}),
            } } })),
            shortcuts: [
                contribution("neuro.official/ocr", "neuro.official/ocr.shortcut.recognize", {
                    commandId: ocrCommand, payload: { keys: "ctrl+4", global: true },
                }),
                contribution("neuro.official/ocr", "neuro.official/ocr.shortcut.toggle-overlay", {
                    commandId: "neuro.official/ocr.toggle-overlay", payload: { keys: "alt+4" },
                }),
                contribution(translationPlugin, `${translationPlugin}.shortcut.toggle`, {
                    commandId: `${translationPlugin}.toggle`, payload: { keys: "ctrl+5", global: true },
                }),
                contribution(translationPlugin, `${translationPlugin}.shortcut.toggle-overlay`, {
                    commandId: `${translationPlugin}.toggle-overlay`, payload: { keys: "alt+5" },
                }),
            ], menus: [], settings: [], unitOverlays: [], backgroundTasks: [],
            resourceProviders: [], diagnostics: [], eventSubscriptions: [],
        },
    });
};

export const success = (effects: ExtensionResult["effects"] = []): ExtensionResult => ({
    protocol: "loom.extension.v1", apiVersion: "1.0", requestId: "translation-result", status: "succeeded", output: {}, effects,
});

export const translatedResponse = (input: unknown, priorRevision = 0, translationPlugin = translator): ExtensionResult => {
    const source = input as Record<string, unknown>;
    return success([{ type: "attachment.upsert", payload: {
        attachmentId: `${translationPlugin}.result`, typeId: `${translationPlugin}.result.v1`, schemaVersion: "1",
        priorRevision, revision: priorRevision + 1, rendererId: `${translationPlugin}.renderer`, resourceRefs: [],
        payload: { ...source, visible: true, originalText: source.text, text: "Translated project settings", surfaceScene: scene("Translated project settings") },
    } }]);
};
