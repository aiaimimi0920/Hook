import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { unwrap } from "solid-js/store";

import { ExtensionUnitOverlayLayer } from "../../src/components/ExtensionUnitOverlayLayer";
import { extensionBridgeClient } from "../../src/services/extensionBridgeClient";
import { extensionCommandRouter } from "../../src/services/extensionCommandRouter";
import { extensionRegistry } from "../../src/services/extensionRegistry";
import { extensionShortcutRegistry } from "../../src/services/extensionShortcutRegistry";
import { applyExtensionVisualSnapshot } from "../../src/services/extensionVisualRegistry";
import { syncService } from "../../src/services/syncService";
import { sanitizePersistedUnitExtensionState } from "../../src/services/unitExtensionValidation";
import { graphStore } from "../../src/store/graphStore";
import { selectionActions } from "../../src/store/uiStore";
import { ocrAttachment, ocrCommand, success, translatedResponse, translationSnapshot, translationUnit } from "../fixtures/translation";

const translator = "neuro.official/text-translation";
const ocrToggle = "neuro.official/ocr.toggle-overlay";
const translationToggle = `${translator}.toggle-overlay`;
const translate = `${translator}.toggle`;
const attachments = () => graphStore.units[0].data.extensionState!.attachments;
const ocr = () => attachments().find((item) => item.pluginId === "neuro.official/ocr")!;

describe("OCR and translation shortcut visibility", () => {
    let container: HTMLDivElement;
    let dispose: () => void;
    const requests: string[] = [];

    it("rejects a cached overlay toggle when the live grant was revoked", async () => {
        graphStore.actions.replaceUnits([translationUnit(true)]);
        const before = JSON.stringify(attachments());
        vi.mocked(extensionBridgeClient.authorizeResources).mockRejectedValue(new Error("grant revoked"));
        await expect(extensionCommandRouter.execute(ocrToggle)).rejects.toThrow("grant revoked");
        expect(JSON.stringify(attachments())).toBe(before);
        expect(extensionBridgeClient.invoke).not.toHaveBeenCalled();
    });

    beforeEach(() => {
        vi.spyOn(extensionBridgeClient, "authorizeResources").mockResolvedValue("extension-auth:00000000-0000-0000-0000-000000000001");
        requests.length = 0;
        vi.spyOn(syncService, "performWorkflowSync").mockResolvedValue(undefined);
        graphStore.actions.replaceUnits([translationUnit(false)]);
        selectionActions.set(["translation-unit"]);
        extensionRegistry.beginSession("overlay-visibility-test");
        const snapshot = translationSnapshot(translator);
        extensionRegistry.applySnapshot("overlay-visibility-test", snapshot);
        extensionShortcutRegistry.applySnapshot(snapshot);
        applyExtensionVisualSnapshot(snapshot);
        vi.spyOn(extensionBridgeClient, "invoke").mockImplementation(async ({ commandId, input, unitAttachments }) => {
            requests.push(commandId);
            if (commandId === ocrCommand) {
                const priorRevision = unitAttachments?.[0]?.revision ?? 0;
                return success([{ type: "attachment.upsert", payload: {
                    ...ocrAttachment(), priorRevision, revision: priorRevision + 1,
                } }]);
            }
            if (commandId === translate || commandId === `${translator}.translate`) {
                return translatedResponse(input, unitAttachments?.[0]?.revision ?? 0, translator);
            }
            // A cached visibility action must not cross the process boundary.
            throw new Error(`unexpected capability request: ${commandId}`);
        });
        container = document.createElement("div");
        document.body.appendChild(container);
        dispose = render(() => <ExtensionUnitOverlayLayer unit={graphStore.units[0]} isMinified={false}
            editorOwnsPointerInput={false} onActivate={() => {}} />, container);
    });

    afterEach(() => {
        dispose();
        container.remove();
        extensionRegistry.disconnect("overlay-visibility-test");
        extensionShortcutRegistry.applySnapshot(null);
        applyExtensionVisualSnapshot(null);
        selectionActions.clear();
        graphStore.actions.replaceUnits([]);
        vi.restoreAllMocks();
    });

    const expectVisible = (kind: "ocr" | "translation" | "none") => {
        expect(container.textContent?.includes("Open project settings")).toBe(kind === "ocr");
        expect(container.textContent?.includes("Translated project settings")).toBe(kind === "translation");
    };

    it("recognizes once, hides and restores OCR without changing its source identity", async () => {
        await extensionCommandRouter.execute(ocrCommand);
        expectVisible("ocr");
        const source = structuredClone(unwrap(ocr()));
        await extensionCommandRouter.execute(ocrToggle);
        expectVisible("none");
        await extensionCommandRouter.execute(ocrToggle);
        expectVisible("ocr");
        expect(ocr()).toMatchObject(source);
        expect(requests).toEqual([ocrCommand]);
    });

    it("reuses both results across Alt+4/Alt+5 and restores the OCR visibility intent", async () => {
        await extensionCommandRouter.execute(ocrCommand);
        const source = structuredClone(unwrap(ocr()));
        await extensionCommandRouter.execute(translate);
        expectVisible("translation");
        await extensionCommandRouter.execute(translationToggle);
        expectVisible("ocr");
        await extensionCommandRouter.execute(translationToggle);
        expectVisible("translation");
        await extensionCommandRouter.execute(ocrToggle);
        expectVisible("ocr");
        await extensionCommandRouter.execute(ocrToggle);
        expectVisible("none");
        await extensionCommandRouter.execute(translationToggle);
        expectVisible("translation");
        await extensionCommandRouter.execute(translationToggle);
        expectVisible("none");
        expect(ocr()).toMatchObject(source);
        expect(attachments()).toHaveLength(2);
        expect(requests).toEqual([ocrCommand, translate]);
    });

    it("preserves an explicitly hidden OCR result while refreshing or toggling translation", async () => {
        await extensionCommandRouter.execute(ocrCommand);
        await extensionCommandRouter.execute(ocrToggle);
        await extensionCommandRouter.execute(translate);
        expectVisible("translation");
        await extensionCommandRouter.execute(translationToggle);
        expectVisible("none");
        await extensionCommandRouter.execute(translate);
        expectVisible("translation");
        await extensionCommandRouter.execute(translationToggle);
        expectVisible("none");
        expect(requests).toEqual([ocrCommand, translate, translate]);
    });

    it.each([translate, translationToggle])("runs OCR then translation on the first %s", async (command) => {
        await extensionCommandRouter.execute(command);
        expectVisible("translation");
        await extensionCommandRouter.execute(translationToggle);
        expectVisible("ocr");
        expect(requests).toEqual([ocrCommand, command === translate ? translate : `${translator}.translate`]);
    });

    it("dispatches first-use Alt+4 and Alt+5 through the shortcut registry", async () => {
        for (const key of ["4", "5"]) {
            const event = new KeyboardEvent("keydown", { key, altKey: true, cancelable: true });
            extensionShortcutRegistry.handleKeyDown(event);
            expect(event.defaultPrevented).toBe(true);
            await vi.waitFor(() => expectVisible(key === "4" ? "ocr" : "translation"));
        }
        expect(requests).toEqual([ocrCommand, `${translator}.translate`]);
    });

    it("refreshes OCR on Ctrl+4 and does not display an obsolete translation", async () => {
        await extensionCommandRouter.execute(translate);
        await extensionCommandRouter.execute(ocrCommand);
        expectVisible("ocr");
        await extensionCommandRouter.execute(translationToggle);
        expectVisible("translation");
        expect(requests).toEqual([ocrCommand, translate, ocrCommand, `${translator}.translate`]);
    });

    it("keeps cached data and hidden intent after persistence round-trip", async () => {
        await extensionCommandRouter.execute(translate);
        await extensionCommandRouter.execute(ocrToggle);
        await extensionCommandRouter.execute(ocrToggle);
        const persisted = JSON.parse(JSON.stringify(graphStore.units[0].data.extensionState)) as unknown;
        const restored = sanitizePersistedUnitExtensionState(persisted);
        expect(restored).toBeDefined();
        graphStore.actions.updateUnitData("translation-unit", { extensionState: restored });
        expectVisible("none");
        await extensionCommandRouter.execute(translationToggle);
        expectVisible("translation");
        await extensionCommandRouter.execute(translationToggle);
        expectVisible("none");
        expect(requests).toEqual([ocrCommand, translate]);
    });

    it("shows a cached payload whose old runtime hid the scene root", async () => {
        const attachment = ocrAttachment();
        attachment.payload = { ...(attachment.payload as Record<string, unknown>), visible: false,
            surfaceScene: { id: "root", type: "text", props: { text: "Open project settings", visible: false } } };
        graphStore.actions.updateUnitData("translation-unit", { extensionState: {
            schemaVersion: 1, revision: 1, attachments: [attachment],
        } });
        expectVisible("none");
        await extensionCommandRouter.execute(ocrToggle);
        expectVisible("ocr");
        expect(ocr().payload).toEqual(attachment.payload);
        expect(requests).toEqual([]);
    });

    it("does not start a second model request or invalidate a pending result when OCR is hidden", async () => {
        await extensionCommandRouter.execute(ocrCommand);
        const invoke = vi.mocked(extensionBridgeClient.invoke);
        const complete = invoke.getMockImplementation()!;
        let finish = () => {};
        const wait = new Promise<void>((resolve) => { finish = resolve; });
        invoke.mockImplementation(async (request) => { await wait; return complete(request); });
        const pending = extensionCommandRouter.execute(translate);
        await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
        await expect(extensionCommandRouter.execute(translationToggle)).rejects.toThrow("already running");
        await extensionCommandRouter.execute(ocrToggle);
        finish();
        await pending;
        expectVisible("translation");
        await extensionCommandRouter.execute(translationToggle);
        expectVisible("none");
        expect(requests).toEqual([ocrCommand, translate]);
    });
});
