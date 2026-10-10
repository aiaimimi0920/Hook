import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionCommandRouter } from "../../src/services/extensionCommandRouter";
import { extensionBridgeClient } from "../../src/services/extensionBridgeClient";
import { extensionRegistry } from "../../src/services/extensionRegistry";
import { parseContributionSnapshot, type ExtensionTrustStatus } from "../../src/services/extensionProtocol";
import { buildExtensionShortcutBindings } from "../../src/services/extensionShortcutRegistry";
import { applyExtensionPresentationSnapshot, extensionPresentationStore } from "../../src/services/extensionPresentationStore";
import * as imageSource from "../../src/services/unitImageSource";
import { graphStore } from "../../src/store/graphStore";
import { selectionActions } from "../../src/store/uiStore";

const permission = "hook.unit.image.read";
const session = "authorization-test";
const commandId = "publisher.example/text-tools.transform";
const image = "data:image/png;base64,iVBORw0KGgo=";
const snapshot = (granted = true, status: ExtensionTrustStatus = "trusted") => {
    const value = parseContributionSnapshot(JSON.parse(readFileSync(resolve(
        process.cwd(), "__tests__/fixtures/capability/extension-snapshot.json",
    ), "utf8")));
    value.plugins[0].effectivePermissions = granted ? [permission] : [];
    value.plugins[0].trustStatus = status;
    value.contributions.commands[0].payload = { permissions: [permission] };
    return value;
};

describe("host-owned extension authorization", () => {
    beforeEach(() => {
        graphStore.actions.replaceUnits([{
            id: "unit-security", type: "sticker", x: 0, y: 0, w: 10, h: 10,
            data: { src: image, stickerEditPropagation: { revision: 1 } }, params: {}, inputs: [], outputs: [],
        }]);
        selectionActions.set(["unit-security"]);
        extensionRegistry.beginSession(session);
        vi.spyOn(extensionBridgeClient, "authorizeResources").mockResolvedValue("extension-auth:00000000-0000-0000-0000-000000000001");
        vi.spyOn(extensionBridgeClient, "invoke").mockResolvedValue({
            protocol: "loom.extension.v1", apiVersion: "1.0", requestId: "result", status: "succeeded", output: {}, effects: [],
        });
        vi.spyOn(imageSource, "resolveUnitImageDataUrl").mockResolvedValue(image);
    });
    afterEach(() => {
        extensionRegistry.disconnect(session);
        extensionRegistry.beginSession("test-cleanup");
        applyExtensionPresentationSnapshot(null);
        selectionActions.clear();
        graphStore.actions.replaceUnits([]);
        vi.restoreAllMocks();
    });

    it("does not treat a command permission declaration as a grant", async () => {
        extensionRegistry.applySnapshot(session, snapshot(false));
        await expect(new ExtensionCommandRouter().execute(commandId)).rejects.toThrow("not granted");
        expect(imageSource.resolveUnitImageDataUrl).not.toHaveBeenCalled();
        expect(extensionBridgeClient.authorizeResources).not.toHaveBeenCalled();
        expect(extensionBridgeClient.invoke).not.toHaveBeenCalled();
    });

    it.each(["revoked", "untrusted", "unsigned_developer"] as const)("rejects %s commands and UI registrations", async (status) => {
        const value = snapshot(true, status);
        extensionRegistry.applySnapshot(session, value);
        expect(extensionRegistry.contributions("commands")).toEqual([]);
        expect(buildExtensionShortcutBindings(value).accepted).toEqual([]);
        applyExtensionPresentationSnapshot(value);
        expect(extensionPresentationStore.toolbarItems()).toEqual([]);
        expect(extensionPresentationStore.paletteItems()).toEqual([]);
        await expect(new ExtensionCommandRouter().execute(commandId)).rejects.toThrow("unavailable");
        expect(imageSource.resolveUnitImageDataUrl).not.toHaveBeenCalled();
    });

    it("checks live authorization before reading image bytes", async () => {
        extensionRegistry.applySnapshot(session, snapshot());
        vi.mocked(extensionBridgeClient.authorizeResources).mockRejectedValue(new Error("grant revoked"));
        await expect(new ExtensionCommandRouter().execute(commandId)).rejects.toThrow("grant revoked");
        expect(imageSource.resolveUnitImageDataUrl).not.toHaveBeenCalled();
        expect(extensionBridgeClient.invoke).not.toHaveBeenCalled();
    });

    it.each(["snapshot", "session"])("does not upload after %s changes during image preparation", async (change) => {
        extensionRegistry.applySnapshot(session, snapshot());
        let finish!: (value: string) => void;
        vi.mocked(imageSource.resolveUnitImageDataUrl).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
        const pending = new ExtensionCommandRouter().execute(commandId);
        const rejected = expect(pending).rejects.toThrow("authority changed");
        await vi.waitFor(() => expect(imageSource.resolveUnitImageDataUrl).toHaveBeenCalledOnce());
        if (change === "session") extensionRegistry.beginSession("replacement");
        else {
            const next = snapshot(false);
            next.generation += 1;
            extensionRegistry.applySnapshot(session, next);
        }
        finish(image);
        await rejected;
        expect(extensionBridgeClient.invoke).not.toHaveBeenCalled();
    });

    it("sends the single-use authorization with an approved image invocation", async () => {
        extensionRegistry.applySnapshot(session, snapshot());
        await new ExtensionCommandRouter().execute(commandId);
        expect(extensionBridgeClient.invoke).toHaveBeenCalledWith(expect.objectContaining({
            authorizationId: "extension-auth:00000000-0000-0000-0000-000000000001",
            resourceUploads: [{ kind: "image", mime: "image/png", dataBase64: "iVBORw0KGgo=" }],
        }));
    });

    it("fails closed on absent, duplicate, or unbounded host permission metadata", () => {
        const missing = snapshot();
        delete missing.plugins[0].effectivePermissions;
        expect(parseContributionSnapshot(missing).plugins[0].effectivePermissions).toEqual([]);
        for (const permissions of [[permission, permission], ["x".repeat(129)], Array(65).fill(permission)]) {
            const invalid = snapshot();
            invalid.plugins[0].effectivePermissions = permissions;
            expect(() => parseContributionSnapshot(invalid)).toThrow("effectivePermissions");
        }
    });
});
