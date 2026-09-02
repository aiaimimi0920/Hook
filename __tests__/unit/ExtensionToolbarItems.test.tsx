// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";

import { ExtensionToolbarItems } from "../../src/components/ExtensionToolbarItems";
import { extensionCommandRouter } from "../../src/services/extensionCommandRouter";
import { parseContributionSnapshot } from "../../src/services/extensionProtocol";
import { applyExtensionPresentationSnapshot } from "../../src/services/extensionPresentationStore";

const snapshot = parseContributionSnapshot({
    protocol: "loom.extension.v1",
    apiVersion: "1.0",
    generation: 1,
    plugins: [{
        id: "publisher/tools",
        version: "1.0.0",
        packageDigest: "a".repeat(64),
        trustStatus: "trusted",
        permissionGrantDigest: "b".repeat(64),
        scopeId: "scope-tools",
    }],
    contributions: {
        commands: [{
            id: "publisher/tools.copy",
            commandId: "publisher/tools.copy",
            pluginId: "publisher/tools",
            scopeId: "scope-tools",
            title: "复制全文",
        }],
        shortcuts: [],
        menus: [{
            id: "publisher/tools.copy-menu",
            commandId: "publisher/tools.copy",
            pluginId: "publisher/tools",
            scopeId: "scope-tools",
            placement: "hook.unit.toolbar",
            title: "复制全文",
            payload: { groupId: "text", groupTitle: "OCR" },
        }],
        settings: [], dataTypes: [], renderers: [], unitOverlays: [], backgroundTasks: [],
        resourceProviders: [], diagnostics: [], eventSubscriptions: [],
    },
});

describe("ExtensionToolbarItems", () => {
    afterEach(() => {
        applyExtensionPresentationSnapshot(null);
        document.body.innerHTML = "";
        vi.restoreAllMocks();
    });

    it("renders manifest groups as one toolbar tab with command children", async () => {
        applyExtensionPresentationSnapshot(snapshot);
        const execute = vi.spyOn(extensionCommandRouter, "execute").mockResolvedValue({
            protocol: "loom.extension.v1",
            apiVersion: "1.0",
            requestId: "toolbar-test",
            status: "succeeded",
            output: null,
            effects: [],
        });
        const host = document.createElement("div");
        document.body.append(host);
        const dispose = render(() => <ExtensionToolbarItems open={true} onOpenChange={() => undefined} />, host);

        host.querySelector<HTMLButtonElement>("[aria-label='OCR 工具']")!.click();
        const menu = host.querySelector<HTMLElement>("[role='menu']");
        expect(menu?.textContent).toContain("复制全文");
        menu!.querySelector<HTMLButtonElement>("[role='menuitem']")!.click();
        expect(execute).toHaveBeenCalledWith("publisher/tools.copy");
        dispose();
    });
});
