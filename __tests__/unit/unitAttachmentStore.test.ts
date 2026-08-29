import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyExtensionEffect } from "../../src/services/extensionCommandRouter";
import { extensionRegistry } from "../../src/services/extensionRegistry";
import { graphStore } from "../../src/store/graphStore";
import type { Unit } from "../../src/types/unit";

const plugin = {
    id: "publisher.example/demo",
    version: "1.2.3",
    packageDigest: "a".repeat(64),
    trustStatus: "trusted" as const,
    permissionGrantDigest: "b".repeat(64),
    scopeId: "scope-demo",
};

const contribution = (id: string) => ({
    id,
    pluginId: plugin.id,
    scopeId: plugin.scopeId,
});

const snapshot = {
    protocol: "loom.extension.v1",
    apiVersion: "1.0",
    generation: 1,
    plugins: [plugin],
    contributions: {
        commands: [], shortcuts: [], menus: [], settings: [],
        dataTypes: [contribution("publisher.example/demo.result.v1")],
        renderers: [contribution("publisher.example/demo.result-card")],
        unitOverlays: [], backgroundTasks: [], resourceProviders: [], diagnostics: [],
        eventSubscriptions: [],
    },
};

const unit = (): Unit => ({
    id: "unit-1",
    type: "sticker",
    x: 0,
    y: 0,
    w: 100,
    h: 80,
    data: { stickerEditPropagation: { revision: 4 } },
    params: {},
    inputs: [],
    outputs: [],
});

const upsertPayload = (overrides: Record<string, unknown> = {}) => ({
    attachmentId: "publisher.example/demo.result",
    typeId: "publisher.example/demo.result.v1",
    schemaVersion: "1.0",
    priorRevision: 0,
    revision: 1,
    rendererId: "publisher.example/demo.result-card",
    payload: { text: "safe" },
    ...overrides,
});

describe("unit attachment store", () => {
    beforeEach(() => {
        graphStore.actions.replaceUnits([unit()]);
        extensionRegistry.beginSession("session-1");
        extensionRegistry.applySnapshot("session-1", snapshot);
    });

    afterEach(() => {
        extensionRegistry.disconnect("session-1");
        graphStore.actions.replaceUnits([]);
    });

    it("persists a host-owned attachment and applies compare-and-swap revisions", async () => {
        await applyExtensionEffect(plugin.scopeId, "unit-1", {
            type: "attachment.upsert",
            payload: upsertPayload(),
        }, 4);

        const state = graphStore.units[0].data.extensionState;
        expect(state?.revision).toBe(1);
        expect(state?.attachments[0]).toMatchObject({
            attachmentId: "publisher.example/demo.result",
            pluginId: plugin.id,
            pluginVersion: plugin.version,
            revision: 1,
            payload: { text: "safe" },
        });
        expect(state?.attachments[0].payloadDigest).toMatch(/^[0-9a-f]{64}$/u);

        await expect(applyExtensionEffect(plugin.scopeId, "unit-1", {
            type: "attachment.upsert",
            payload: upsertPayload({ payload: { text: "stale" } }),
        }, 4)).rejects.toThrow("compare-and-swap");
    });

    it("serializes concurrent compare-and-swap mutations for the same unit", async () => {
        const results = await Promise.allSettled([
            applyExtensionEffect(plugin.scopeId, "unit-1", {
                type: "attachment.upsert",
                payload: upsertPayload({ payload: { text: "first" } }),
            }, 4),
            applyExtensionEffect(plugin.scopeId, "unit-1", {
                type: "attachment.upsert",
                payload: upsertPayload({ payload: { text: "second" } }),
            }, 4),
        ]);

        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
        expect(graphStore.units[0].data.extensionState?.attachments).toHaveLength(1);
    });

    it("rejects undeclared types, stale targets, and arbitrary resource paths", async () => {
        await expect(applyExtensionEffect(plugin.scopeId, "unit-1", {
            type: "attachment.upsert",
            payload: upsertPayload({ typeId: "another.plugin/result" }),
        }, 4)).rejects.toThrow("not registered");

        await expect(applyExtensionEffect(plugin.scopeId, "unit-1", {
            type: "attachment.upsert",
            payload: upsertPayload({ attachmentId: "another.plugin.result" }),
        }, 4)).rejects.toThrow("plugin namespace");

        await expect(applyExtensionEffect(plugin.scopeId, "unit-1", {
            type: "attachment.upsert",
            payload: upsertPayload(),
        }, 3)).rejects.toThrow("target is stale");

        await expect(applyExtensionEffect(plugin.scopeId, "unit-1", {
            type: "attachment.upsert",
            payload: upsertPayload({
                payload: undefined,
                resourceRefs: [{
                    resourceId: "file:C:/private.txt",
                    kind: "file",
                    digest: "c".repeat(64),
                    byteLength: 10,
                    leaseId: "lease-1",
                }],
            }),
        }, 4)).rejects.toThrow("not content addressed");
    });

    it("removes only an attachment owned by the active plugin", async () => {
        await applyExtensionEffect(plugin.scopeId, "unit-1", {
            type: "attachment.upsert",
            payload: upsertPayload(),
        }, 4);
        await applyExtensionEffect(plugin.scopeId, "unit-1", {
            type: "attachment.remove",
            payload: { attachmentId: "publisher.example/demo.result", priorRevision: 1 },
        }, 4);
        expect(graphStore.units[0].data.extensionState).toMatchObject({ revision: 2, attachments: [] });
    });
});
