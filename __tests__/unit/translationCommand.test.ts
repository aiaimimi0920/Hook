import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionCommandRouter } from "../../src/services/extensionCommandRouter";
import { extensionBridgeClient } from "../../src/services/extensionBridgeClient";
import { extensionRegistry } from "../../src/services/extensionRegistry";
import { extensionNoticeRegistry } from "../../src/services/extensionNoticeRegistry";
import * as settings from "../../src/services/appSettings";
import { graphStore } from "../../src/store/graphStore";
import { selectionActions } from "../../src/store/uiStore";
import { syncService } from "../../src/services/syncService";
import { ocrAttachment, ocrCommand, success, toggleCommand, translatedResponse,
    translationSnapshot, translationUnit, translator } from "../fixtures/translation";

describe("declared OCR text command context", () => {
    beforeEach(() => {
        vi.spyOn(extensionBridgeClient, "authorizeResources").mockResolvedValue("extension-auth:00000000-0000-0000-0000-000000000001");
        vi.spyOn(syncService, "performWorkflowSync").mockResolvedValue(undefined);
        graphStore.actions.replaceUnits([translationUnit()]);
        selectionActions.set(["translation-unit"]);
        extensionRegistry.beginSession("translation-test");
        extensionRegistry.applySnapshot("translation-test", translationSnapshot());
        document.documentElement.lang = "zh-Hans";
        vi.spyOn(settings, "getCurrentAppSettings").mockReturnValue({ ...settings.getCurrentAppSettings(), translationTargetLanguage: "" });
    });
    afterEach(() => {
        extensionRegistry.disconnect("translation-test");
        selectionActions.clear();
        graphStore.actions.replaceUnits([]);
        document.documentElement.lang = "";
        vi.restoreAllMocks();
    });

    it("exports only normalized OCR text and preserves the original OCR attachment", async () => {
        const invoke = vi.spyOn(extensionBridgeClient, "invoke").mockImplementation(async ({ input }) => translatedResponse(input));
        const router = new ExtensionCommandRouter();
        await router.execute(toggleCommand);
        const request = invoke.mock.calls[0][0];
        expect(request.pluginId).toBe(translator);
        expect(request.unitAttachments).toEqual([]);
        expect(request.resourceUploads).toEqual([]);
        expect(request.input).toMatchObject({ text: "Open project settings", targetLanguage: "zh-CN", sourceRevision: 4 });
        expect(JSON.stringify(request.input)).not.toContain("never exported");
        expect(graphStore.units[0].data.extensionState?.attachments).toHaveLength(2);
        expect(graphStore.units[0].data.extensionState?.attachments[0]).toEqual(ocrAttachment());
    });

    it.each([["", "en", "en"], ["zh-CN", "en", "zh-CN"], ["en", "zh-Hans", "en"]] as const)(
        "uses setting %s and display language %s as %s", async (configured, display, expected) => {
            vi.mocked(settings.getCurrentAppSettings).mockReturnValue({ ...settings.getCurrentAppSettings(), translationTargetLanguage: configured });
            document.documentElement.lang = display;
            const invoke = vi.spyOn(extensionBridgeClient, "invoke").mockResolvedValue(success());
            await new ExtensionCommandRouter().execute(toggleCommand);
            expect(invoke.mock.calls[0][0].input).toMatchObject({ targetLanguage: expected });
        },
    );

    it.each(["local", "gateway"] as const)("forwards the selected provider mode %s", async (providerMode) => {
        vi.mocked(settings.getCurrentAppSettings).mockReturnValue({ ...settings.getCurrentAppSettings(), translationProviderMode: providerMode });
        const invoke = vi.spyOn(extensionBridgeClient, "invoke").mockResolvedValue(success());
        await new ExtensionCommandRouter().execute(toggleCommand);
        expect(invoke.mock.calls[0][0].input).toMatchObject({ providerMode });
    });

    it("omits the default auto mode for older capability compatibility", async () => {
        vi.mocked(settings.getCurrentAppSettings).mockReturnValue({ ...settings.getCurrentAppSettings(), translationProviderMode: "auto" });
        const invoke = vi.spyOn(extensionBridgeClient, "invoke").mockResolvedValue(success());
        await new ExtensionCommandRouter().execute(toggleCommand);
        expect(invoke.mock.calls[0][0].input).not.toHaveProperty("providerMode");
    });

    it("runs official OCR first when missing and consumes its real attachment effect", async () => {
        graphStore.actions.replaceUnits([translationUnit(false)]);
        const invoke = vi.spyOn(extensionBridgeClient, "invoke").mockImplementation(async ({ commandId, input }) => {
            if (commandId === ocrCommand) return success([{ type: "attachment.upsert", payload: {
                ...ocrAttachment(), priorRevision: 0, revision: 1,
            } }]);
            return translatedResponse(input);
        });
        await new ExtensionCommandRouter().execute(toggleCommand);
        expect(invoke.mock.calls.map(([request]) => request.commandId)).toEqual([ocrCommand, toggleCommand]);
        const authorize = vi.mocked(extensionBridgeClient.authorizeResources);
        expect(authorize.mock.calls.map(([request]) => [request.commandId, request.checkOnly ?? false])).toEqual([
            [toggleCommand, true], [ocrCommand, false], [toggleCommand, false],
        ]);
        expect(authorize.mock.invocationCallOrder[2]).toBeGreaterThan(invoke.mock.invocationCallOrder[0]);
        expect(invoke.mock.calls[1][0].input).toMatchObject({ sourceAttachment: { revision: 1, digest: expect.stringMatching(/^[a-f0-9]{64}$/u) } });
        expect(graphStore.units[0].data.extensionState?.attachments).toHaveLength(2);
    });

    it("uses Alt+4 as first-run OCR when no OCR result exists", async () => {
        graphStore.actions.replaceUnits([translationUnit(false)]);
        const invoke = vi.spyOn(extensionBridgeClient, "invoke").mockImplementation(async ({ commandId }) => {
            expect(commandId).toBe(ocrCommand);
            return success([{ type: "attachment.upsert", payload: {
                ...ocrAttachment(), priorRevision: 0, revision: 1,
            } }]);
        });

        await new ExtensionCommandRouter().execute("neuro.official/ocr.toggle-overlay");

        expect(invoke).toHaveBeenCalledOnce();
        expect(graphStore.units[0].data.extensionState?.attachments).toHaveLength(1);
    });

    it("rejects empty OCR without calling the translation provider", async () => {
        const attachment = ocrAttachment();
        attachment.payload = { fullText: "   ", sourceWidth: 100, sourceHeight: 80, textBlocks: [] };
        graphStore.actions.updateUnitData("translation-unit", { extensionState: { schemaVersion: 1, revision: 2, attachments: [attachment] } });
        const invoke = vi.spyOn(extensionBridgeClient, "invoke");
        await expect(new ExtensionCommandRouter().execute(toggleCommand)).rejects.toThrow("OCR text is empty");
        expect(invoke).not.toHaveBeenCalled();
    });

    it("rejects a duplicate in-flight translation request", async () => {
        let finish = () => {};
        const wait = new Promise<void>((resolve) => { finish = resolve; });
        const invoke = vi.spyOn(extensionBridgeClient, "invoke").mockImplementation(async ({ input }) => {
            await wait;
            return translatedResponse(input);
        });
        const router = new ExtensionCommandRouter();
        const pending = router.execute(toggleCommand);
        await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
        await expect(router.execute(toggleCommand)).rejects.toThrow("already running");
        finish();
        await pending;
        expect(graphStore.units[0].data.extensionState?.attachments).toHaveLength(2);
    });

    it.each(["selection", "image", "revision", "ocr"])("rejects an in-flight result after %s changes", async (change) => {
        let finish = () => {};
        const wait = new Promise<void>((resolve) => { finish = resolve; });
        const invoke = vi.spyOn(extensionBridgeClient, "invoke").mockImplementation(async ({ input }) => { await wait; return translatedResponse(input); });
        const pending = new ExtensionCommandRouter().execute(toggleCommand);
        const rejected = expect(pending).rejects.toThrow("source changed");
        await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
        if (change === "selection") selectionActions.clear();
        if (change === "image") graphStore.actions.updateUnitData("translation-unit", { src: "different-image" });
        if (change === "revision") graphStore.actions.updateUnitData("translation-unit", { stickerEditPropagation: { revision: 5 } });
        if (change === "ocr") graphStore.actions.updateUnitData("translation-unit", { extensionState: {
            schemaVersion: 1, revision: 2, attachments: [{ ...ocrAttachment(), revision: 4 }],
        } });
        finish();
        await rejected;
        expect(graphStore.units[0].data.extensionState?.attachments).toHaveLength(1);
    });

    it("checks source again after the asynchronous attachment digest", async () => {
        vi.spyOn(extensionBridgeClient, "invoke").mockImplementation(async ({ input }) => translatedResponse(input));
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(extensionNoticeRegistry, "show").mockImplementation(() => {});
        const digest = crypto.subtle.digest.bind(crypto.subtle);
        vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(async (algorithm, data) => {
            graphStore.actions.updateUnitData("translation-unit", { extensionState: {
                schemaVersion: 1, revision: 2, attachments: [{ ...ocrAttachment(), revision: 4 }],
            } });
            return digest(algorithm, data);
        });
        await expect(new ExtensionCommandRouter().execute(toggleCommand)).rejects.toThrow("1 extension effect(s) failed");
        expect(graphStore.units[0].data.extensionState?.attachments).toHaveLength(1);
    });

    it("provider failure preserves the original OCR", async () => {
        vi.spyOn(extensionBridgeClient, "invoke").mockResolvedValue({ ...success(), status: "failed", error: { code: "runtime_fault", message: "provider failed" } });
        await expect(new ExtensionCommandRouter().execute(toggleCommand)).rejects.toThrow("provider failed");
        expect(graphStore.units[0].data.extensionState?.attachments).toEqual([ocrAttachment()]);
    });
});
