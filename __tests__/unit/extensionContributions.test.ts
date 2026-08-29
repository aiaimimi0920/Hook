import { describe, expect, it } from "vitest";

import { parseContributionSnapshot } from "../../src/services/extensionProtocol";
import { applyExtensionEffect } from "../../src/services/extensionCommandRouter";
import { buildExtensionShortcutBindings } from "../../src/services/extensionShortcutRegistry";
import {
    applyExtensionPresentationSnapshot,
    extensionPresentationStore,
    visibleExtensionToolbarSlots,
} from "../../src/services/extensionPresentationStore";
import { ExtensionNoticeRegistry } from "../../src/services/extensionNoticeRegistry";
import { enhancementNotices, uiActions } from "../../src/store/uiStore";

const contributionSnapshot = () => parseContributionSnapshot({
    protocol: "loom.extension.v1",
    apiVersion: "1.0",
    generation: 7,
    plugins: [{
        id: "third.party/demo",
        version: "1.0.0",
        packageDigest: "a".repeat(64),
        trustStatus: "trusted",
        permissionGrantDigest: "b".repeat(64),
        scopeId: "scope-demo",
    }],
    contributions: {
        commands: [{
            id: "third.party/demo.run",
            pluginId: "third.party/demo",
            scopeId: "scope-demo",
            title: "Run unknown command",
            commandId: "third.party/demo.run",
        }],
        shortcuts: [
            {
                id: "third.party/demo.shortcut-a",
                pluginId: "third.party/demo",
                scopeId: "scope-demo",
                commandId: "third.party/demo.run",
                order: 1,
                payload: { schema: "shortcut.v1", payload: { keys: "Ctrl+Shift+Y" } },
            },
            {
                id: "third.party/demo.shortcut-b",
                pluginId: "third.party/demo",
                scopeId: "scope-demo",
                commandId: "third.party/demo.run",
                order: 2,
                payload: { schema: "shortcut.v1", payload: { keys: "Ctrl+Shift+Y" } },
            },
            {
                id: "third.party/demo.shortcut-global",
                pluginId: "third.party/demo",
                scopeId: "scope-demo",
                commandId: "third.party/demo.run",
                payload: { schema: "shortcut.v1", payload: { keys: "Ctrl+2", global: true } },
            },
        ],
        menus: [{
            id: "third.party/demo.toolbar",
            pluginId: "third.party/demo",
            scopeId: "scope-demo",
            commandId: "third.party/demo.run",
            placement: "hook.unit.toolbar",
            title: "Unknown tool",
            payload: {
                groupId: "third.party/demo.tools",
                groupTitle: "Demo",
            },
        }],
        settings: [], dataTypes: [], renderers: [], unitOverlays: [], backgroundTasks: [],
        resourceProviders: [], diagnostics: [], eventSubscriptions: [],
    },
});

describe("generic extension contributions", () => {
    it("accepts plugin-owned Ctrl+2 and resolves deterministic conflicts", () => {
        const result = buildExtensionShortcutBindings(contributionSnapshot());
        expect(result.accepted.map((binding) => binding.id)).toEqual([
            "third.party/demo.shortcut-global",
            "third.party/demo.shortcut-a",
        ]);
        expect(result.accepted[0].global).toBe(true);
        expect(result.rejected).toEqual(["third.party/demo.shortcut-b"]);
    });

    it("publishes unknown commands to toolbar and palette and removes them atomically", () => {
        applyExtensionPresentationSnapshot(contributionSnapshot());
        expect(extensionPresentationStore.toolbarItems().map((item) => item.commandId)).toEqual([
            "third.party/demo.run",
        ]);
        expect(visibleExtensionToolbarSlots(extensionPresentationStore.toolbarItems())).toMatchObject([{
            title: "Demo",
            grouped: true,
            items: [{ commandId: "third.party/demo.run" }],
        }]);
        expect(extensionPresentationStore.paletteItems().map((item) => item.commandId)).toEqual([
            "third.party/demo.run",
        ]);

        applyExtensionPresentationSnapshot(null);
        expect(extensionPresentationStore.toolbarItems()).toEqual([]);
        expect(extensionPresentationStore.paletteItems()).toEqual([]);
    });

    it("removes only notices owned by a disconnected extension scope", () => {
        const notices = new ExtensionNoticeRegistry();
        uiActions.dismissEnhancementNotice("unit-1");
        notices.show("scope-demo", "unit-1", { title: "Demo", message: "Done" });
        uiActions.showEnhancementNotice("unit-1", {
            id: 42,
            feature: "Interaction",
            title: "Core",
            message: "Keep",
        });

        notices.applySnapshot(null);
        expect(enhancementNotices["unit-1"]?.map((notice) => notice.id)).toEqual([42]);
        uiActions.dismissEnhancementNotice("unit-1");
    });

    it("removes notices when an extension becomes untrusted", () => {
        const notices = new ExtensionNoticeRegistry();
        const snapshot = contributionSnapshot();
        notices.show("scope-demo", "unit-revoked", { message: "Pending" });
        notices.applySnapshot({
            ...snapshot,
            plugins: snapshot.plugins.map((plugin) => ({ ...plugin, trustStatus: "revoked" })),
        });

        expect(enhancementNotices["unit-revoked"]).toBeUndefined();
    });

    it("keeps extension notice ownership bounded during a long-lived session", () => {
        const notices = new ExtensionNoticeRegistry();
        uiActions.dismissEnhancementNotice("unit-bounded");
        for (let index = 0; index < 20; index += 1) {
            notices.show("scope-demo", "unit-bounded", { message: `Notice ${index}` });
        }
        expect(enhancementNotices["unit-bounded"]).toHaveLength(8);

        notices.applySnapshot(null);
        expect(enhancementNotices["unit-bounded"]).toBeUndefined();
    });

    it("fails closed for unsupported or malformed command effects", async () => {
        await expect(applyExtensionEffect("scope-demo", "unit-1", {
            type: "overlay.invalidate",
            payload: {},
        }, 0)).rejects.toThrow("not implemented");
        await expect(applyExtensionEffect("scope-demo", "unit-1", {
            type: "clipboard.writeText",
            payload: {},
        }, 0)).rejects.toThrow("requires text");
    });
});
