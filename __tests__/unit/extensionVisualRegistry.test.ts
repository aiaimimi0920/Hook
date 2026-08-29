import { afterEach, describe, expect, it } from "vitest";

import {
    applyExtensionVisualSnapshot,
    extensionVisualRegistry,
} from "../../src/services/extensionVisualRegistry";
import { parseContributionSnapshot } from "../../src/services/extensionProtocol";
import type { UnitAttachment } from "../../src/types/unitExtension";

const scene = {
    id: "root",
    type: "column",
    children: [{
        id: "copy",
        type: "button",
        props: { label: "Copy" },
        events: { click: "publisher.example/demo.copy" },
    }],
};

const contribution = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    pluginId: "publisher.example/demo",
    scopeId: "scope-demo",
    ...extra,
});

const snapshot = (overrideScene: unknown = scene) => parseContributionSnapshot({
    protocol: "loom.extension.v1",
    apiVersion: "1.0",
    generation: 4,
    plugins: [{
        id: "publisher.example/demo",
        version: "1.0.0",
        packageDigest: "a".repeat(64),
        trustStatus: "trusted",
        permissionGrantDigest: "b".repeat(64),
        scopeId: "scope-demo",
    }],
    contributions: {
        commands: [contribution("publisher.example/demo.copy", {
            commandId: "publisher.example/demo.copy",
            title: "Copy",
        })],
        shortcuts: [], menus: [], settings: [],
        dataTypes: [contribution("publisher.example/demo.result.v1")],
        renderers: [contribution("publisher.example/demo.renderer", {
            commandId: "publisher.example/demo.copy",
            payload: {
                schema: "renderer.v1",
                payload: {
                    typeId: "publisher.example/demo.result.v1",
                    bounds: { x: 4, y: 6, width: 80, height: 28 },
                    scene: overrideScene,
                },
            },
        })],
        unitOverlays: [contribution("publisher.example/demo.overlay", {
            commandId: "publisher.example/demo.copy",
            payload: {
                schema: "unit-overlay.v1",
                payload: {
                    typeId: "publisher.example/demo.result.v1",
                    bounds: { x: 0, y: 0, width: 100, height: 40 },
                    scene,
                },
            },
        })],
        backgroundTasks: [], resourceProviders: [], diagnostics: [], eventSubscriptions: [],
    },
});

const attachment: UnitAttachment = {
    attachmentId: "publisher.example/demo.result",
    typeId: "publisher.example/demo.result.v1",
    schemaVersion: "1.0",
    revision: 1,
    pluginId: "publisher.example/demo",
    pluginVersion: "1.0.0",
    rendererId: "publisher.example/demo.renderer",
    payload: { text: "hello" },
    payloadDigest: "c".repeat(64),
    resourceRefs: [],
};

describe("extension visual registry", () => {
    afterEach(() => applyExtensionVisualSnapshot(null));

    it("registers declared data types, bounded renderers, and interactive overlays", () => {
        applyExtensionVisualSnapshot(snapshot());

        expect(extensionVisualRegistry.attachmentAvailable(attachment)).toBe(true);
        expect(extensionVisualRegistry.rendererFor(attachment)).toMatchObject({
            id: "publisher.example/demo.renderer",
            typeId: attachment.typeId,
        });
        expect(extensionVisualRegistry.overlaysFor(attachment)).toHaveLength(1);
        expect(extensionVisualRegistry.rendererFor(attachment)?.scene.children?.[0].events).toEqual({
            click: "publisher.example/demo.copy",
        });
        expect(extensionVisualRegistry.diagnostics()).toEqual({
            dataTypes: 1,
            renderers: 1,
            unitOverlays: 1,
            rejectedContributions: 0,
        });
    });

    it("rejects unsafe scene node types and atomically clears disconnected registrations", () => {
        applyExtensionVisualSnapshot(snapshot({ id: "root", type: "html", props: { html: "<script>" } }));
        expect(extensionVisualRegistry.rendererFor(attachment)).toBeUndefined();
        expect(extensionVisualRegistry.diagnostics().rejectedContributions).toBe(1);

        applyExtensionVisualSnapshot(null);
        expect(extensionVisualRegistry.attachmentAvailable(attachment)).toBe(false);
        expect(extensionVisualRegistry.diagnostics()).toEqual({
            dataTypes: 0,
            renderers: 0,
            unitOverlays: 0,
            rejectedContributions: 0,
        });
    });
});
