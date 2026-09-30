import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExtensionCommandRouter } from "../../src/services/extensionCommandRouter";
import { extensionBridgeClient } from "../../src/services/extensionBridgeClient";
import type { ExtensionResult } from "../../src/services/extensionBridgeProtocol";
import { extensionNoticeRegistry } from "../../src/services/extensionNoticeRegistry";
import { parseContributionSnapshot } from "../../src/services/extensionProtocol";
import { extensionRegistry } from "../../src/services/extensionRegistry";
import { graphStore } from "../../src/store/graphStore";
import { selectionActions } from "../../src/store/uiStore";
import type { Unit } from "../../src/types/unit";

const commandId = "publisher.example/demo.run";
const sessionId = "router-test-session";

const unit = (): Unit => ({
    id: "unit-1",
    type: "sticker",
    x: 0,
    y: 0,
    w: 100,
    h: 80,
    data: {
        stickerEditPropagation: { revision: 4 },
        extensionState: {
            schemaVersion: 1,
            revision: 1,
            attachments: [{
                attachmentId: "publisher.example/demo.cached",
                typeId: "publisher.example/demo.cached.v1",
                schemaVersion: "1.0",
                revision: 1,
                pluginId: "publisher.example/demo",
                pluginVersion: "1.0.0",
                payload: { text: "cached" },
                payloadDigest: "c".repeat(64),
                resourceRefs: [],
            }],
        },
    },
    params: {},
    inputs: [],
    outputs: [],
});

const snapshot = (
    payload: unknown = { requiresUserGesture: false },
    generation = 1,
) => parseContributionSnapshot({
    protocol: "loom.extension.v1",
    apiVersion: "1.0",
    generation,
    plugins: [{
        id: "publisher.example/demo",
        version: "1.0.0",
        packageDigest: "a".repeat(64),
        trustStatus: "trusted",
        permissionGrantDigest: "b".repeat(64),
        scopeId: "scope-demo",
    }],
    contributions: {
        commands: [{
            id: commandId,
            pluginId: "publisher.example/demo",
            scopeId: "scope-demo",
            commandId,
            title: "Run",
            payload,
        }],
        shortcuts: [], menus: [], settings: [], dataTypes: [], renderers: [],
        unitOverlays: [], backgroundTasks: [], resourceProviders: [], diagnostics: [],
        eventSubscriptions: [],
    },
});

const result = (overrides: Partial<ExtensionResult> = {}): ExtensionResult => ({
    protocol: "loom.extension.v1",
    apiVersion: "1.0",
    requestId: "request-1",
    status: "succeeded",
    output: {},
    effects: [],
    ...overrides,
});

describe("ExtensionCommandRouter", () => {
    beforeEach(() => {
        graphStore.actions.replaceUnits([unit()]);
        selectionActions.set(["unit-1"]);
        extensionRegistry.beginSession(sessionId);
        extensionRegistry.applySnapshot(sessionId, snapshot());
    });

    afterEach(() => {
        extensionRegistry.disconnect(sessionId);
        selectionActions.clear();
        graphStore.actions.replaceUnits([]);
        vi.restoreAllMocks();
    });

    it("attempts all local effects and rejects a partially applied command", async () => {
        const response = result({
            effects: [
                { type: "overlay.invalidate", payload: {} },
                { type: "notice.show", payload: { title: "Completed", message: "Kept running" } },
            ],
        });
        vi.spyOn(extensionBridgeClient, "invoke").mockResolvedValue(response);
        const notices = vi.spyOn(extensionNoticeRegistry, "show").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);

        await expect(new ExtensionCommandRouter().execute(commandId)).rejects.toThrow("1 extension effect(s) failed");

        expect(notices).toHaveBeenNthCalledWith(1, "scope-demo", "unit-1", {
            title: "Completed",
            message: "Kept running",
        });
        expect(notices).toHaveBeenNthCalledWith(2, "scope-demo", "unit-1", expect.objectContaining({
            title: "扩展操作部分未完成",
            message: expect.stringContaining("1 个扩展操作未完成"),
        }));
    });

    it("preserves the effect failure when its notice cannot be displayed", async () => {
        const response = result({
            effects: [
                { type: "overlay.invalidate", payload: {} },
                { type: "resource.publish", payload: {} },
            ],
        });
        vi.spyOn(extensionBridgeClient, "invoke").mockResolvedValue(response);
        const notices = vi.spyOn(extensionNoticeRegistry, "show").mockImplementation(() => {
            throw new Error("notice host unavailable");
        });
        vi.spyOn(console, "error").mockImplementation(() => undefined);

        await expect(new ExtensionCommandRouter().execute(commandId)).rejects.toThrow("2 extension effect(s) failed");

        expect(notices).toHaveBeenCalledWith("scope-demo", "unit-1", expect.objectContaining({
            message: expect.stringContaining("2 个扩展操作未完成"),
        }));
    });

    it("still rejects an explicit runtime failure", async () => {
        vi.spyOn(extensionBridgeClient, "invoke").mockResolvedValue(result({
            status: "failed",
            error: { code: "runtime_fault", message: "runtime failed" },
        }));

        await expect(new ExtensionCommandRouter().execute(commandId)).rejects.toThrow("runtime failed");
    });

    it("reads command policy from a schema payload envelope", async () => {
        extensionRegistry.applySnapshot(sessionId, snapshot({
            schema: "command.v1",
            payload: {
                requiresUserGesture: false,
                timeoutMs: 1_234,
                permissions: ["hook.unit.attachments.read"],
            },
        }, 2));
        vi.spyOn(extensionBridgeClient, "invoke").mockResolvedValue(result());

        await new ExtensionCommandRouter().execute(commandId);

        expect(extensionBridgeClient.invoke).toHaveBeenCalledWith(expect.objectContaining({
            timeoutMs: 11_234,
            userGestureToken: undefined,
            unitAttachments: [expect.objectContaining({
                attachmentId: "publisher.example/demo.cached",
            })],
        }));
    });

    it("does not unwrap a direct command field named payload", async () => {
        extensionRegistry.applySnapshot(sessionId, snapshot({
            requiresUserGesture: false,
            timeoutMs: 2_222,
            permissions: ["hook.unit.attachments.read"],
            payload: { businessValue: "opaque" },
        }, 2));
        vi.spyOn(extensionBridgeClient, "invoke").mockResolvedValue(result());

        await new ExtensionCommandRouter().execute(commandId);

        expect(extensionBridgeClient.invoke).toHaveBeenCalledWith(expect.objectContaining({
            timeoutMs: 12_222,
            userGestureToken: undefined,
            unitAttachments: [expect.objectContaining({
                attachmentId: "publisher.example/demo.cached",
            })],
        }));
    });
});
