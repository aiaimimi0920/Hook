import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";

import { ExtensionUnitOverlayLayer } from "../../src/components/ExtensionUnitOverlayLayer";
import { extensionCommandRouter } from "../../src/services/extensionCommandRouter";
import { extensionHostDiagnostics } from "../../src/services/extensionHostDiagnostics";
import { applyExtensionVisualSnapshot } from "../../src/services/extensionVisualRegistry";
import { parseContributionSnapshot } from "../../src/services/extensionProtocol";
import { extraRects, removeRect } from "../../src/services/uiRegistry";
import type { Unit } from "../../src/types/unit";

const contribution = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    pluginId: "publisher.example/demo",
    scopeId: "scope-demo",
    ...extra,
});

const snapshot = parseContributionSnapshot({
    protocol: "loom.extension.v1",
    apiVersion: "1.0",
    generation: 1,
    plugins: [{
        id: "publisher.example/demo",
        version: "1.0.0",
        packageDigest: "a".repeat(64),
        trustStatus: "trusted",
        permissionGrantDigest: "b".repeat(64),
        scopeId: "scope-demo",
    }],
    contributions: {
        commands: [contribution("publisher.example/demo.run", { commandId: "publisher.example/demo.run" })],
        shortcuts: [], menus: [], settings: [],
        dataTypes: [contribution("publisher.example/demo.result.v1")],
        renderers: [],
        unitOverlays: [contribution("publisher.example/demo.overlay", {
            commandId: "publisher.example/demo.run",
            payload: {
                schema: "unit-overlay.v1",
                payload: {
                    typeId: "publisher.example/demo.result.v1",
                    bounds: { x: 80, y: 30, width: 40, height: 30 },
                    scene: {
                        id: "run",
                        type: "button",
                        props: { label: "Run" },
                        events: { click: "publisher.example/demo.run" },
                    },
                },
            },
        })],
        backgroundTasks: [], resourceProviders: [], diagnostics: [], eventSubscriptions: [],
    },
});

const unit: Unit = {
    id: "unit-soak",
    type: "sticker",
    x: 10,
    y: 20,
    w: 100,
    h: 50,
    params: {},
    inputs: [],
    outputs: [],
    data: {
        extensionState: {
            schemaVersion: 1,
            revision: 1,
            attachments: [{
                attachmentId: "publisher.example/demo.result",
                typeId: "publisher.example/demo.result.v1",
                schemaVersion: "1.0",
                revision: 1,
                pluginId: "publisher.example/demo",
                pluginVersion: "1.0.0",
                payload: { ok: true },
                payloadDigest: "c".repeat(64),
                resourceRefs: [],
            }],
        },
    },
};

const extensionRectCount = () => extraRects().filter((rect) => rect.name === "EXTENSION_OVERLAY").length;

describe("extension host cleanup soak", () => {
    afterEach(() => {
        applyExtensionVisualSnapshot(null);
        extraRects().filter((rect) => rect.name === "EXTENSION_OVERLAY").forEach((rect) => removeRect(rect.id));
        document.body.replaceChildren();
        vi.restoreAllMocks();
    });

    it("routes overlay clicks and retains no host objects across 100 enable/disable cycles", async () => {
        const baseline = extensionHostDiagnostics();
        const root = document.createElement("div");
        document.body.append(root);
        const [isMinified, setIsMinified] = createSignal(false);
        const onActivate = vi.fn();
        const execute = vi.spyOn(extensionCommandRouter, "execute").mockResolvedValue(null);
        const dispose = render(() => (
            <ExtensionUnitOverlayLayer
                unit={unit}
                isMinified={isMinified()}
                editorOwnsPointerInput={false}
                onActivate={onActivate}
            />
        ), root);

        for (let index = 0; index < 100; index += 1) {
            applyExtensionVisualSnapshot(snapshot);
            expect(extensionRectCount()).toBe(1);
            expect(extensionHostDiagnostics().visuals.unitOverlays).toBe(1);
            expect(extensionHostDiagnostics().extensionSurfaceInstances).toBe(1);
            expect(extensionHostDiagnostics().surfaceInstances).toBe(baseline.surfaceInstances + 1);
            if (index === 0) {
                (root.querySelector("button") as HTMLButtonElement).click();
                await Promise.resolve();
                await Promise.resolve();
                expect(onActivate).toHaveBeenCalledTimes(1);
                expect(execute).toHaveBeenCalledWith("publisher.example/demo.run", {
                    surfaceEvent: expect.objectContaining({
                        attachmentId: "publisher.example/demo.result",
                        nodeId: "run",
                        event: "click",
                        action: "publisher.example/demo.run",
                        payload: {},
                    }),
                });
            }
            setIsMinified(true);
            expect(extensionRectCount()).toBe(0);
            setIsMinified(false);
            expect(extensionRectCount()).toBe(1);
            applyExtensionVisualSnapshot(null);
            expect(extensionRectCount()).toBe(0);
            expect(extensionHostDiagnostics().visuals.unitOverlays).toBe(0);
            expect(extensionHostDiagnostics().extensionSurfaceInstances).toBe(0);
            expect(extensionHostDiagnostics().surfaceInstances).toBe(baseline.surfaceInstances);
            expect(extensionHostDiagnostics().listeners).toBe(baseline.listeners);
            expect(extensionHostDiagnostics().timers).toBe(baseline.timers);
        }

        dispose();
        expect(extensionRectCount()).toBe(0);
        expect(extensionHostDiagnostics().extensionSurfaceInstances).toBe(0);
        expect(extensionHostDiagnostics().surfaceInstances).toBe(baseline.surfaceInstances);
        expect(extensionHostDiagnostics().listeners).toBe(baseline.listeners);
        expect(extensionHostDiagnostics().timers).toBe(baseline.timers);
    });

    it("yields DOM and native pointer ownership while the sticker editor is active", async () => {
        const root = document.createElement("div");
        document.body.append(root);
        const [editorOwnsPointerInput, setEditorOwnsPointerInput] = createSignal(false);
        const execute = vi.spyOn(extensionCommandRouter, "execute").mockResolvedValue(null);
        const dispose = render(() => (
            <ExtensionUnitOverlayLayer
                unit={unit}
                isMinified={false}
                editorOwnsPointerInput={editorOwnsPointerInput()}
                onActivate={() => undefined}
            />
        ), root);
        applyExtensionVisualSnapshot(snapshot);

        const surface = () => root.querySelector<HTMLElement>(".extension-unit-surface");
        const declarativeSurface = () => root.querySelector<HTMLElement>(".declarative-surface");
        const button = () => root.querySelector<HTMLButtonElement>("button");
        expect(extensionRectCount()).toBe(1);
        expect(surface()?.dataset.editorPointerPassthrough).toBe("false");
        expect(button()?.disabled).toBe(false);

        setEditorOwnsPointerInput(true);
        expect(extensionRectCount()).toBe(0);
        expect(surface()?.dataset.editorPointerPassthrough).toBe("true");
        expect(getComputedStyle(surface()!).pointerEvents).toBe("none");
        expect(getComputedStyle(declarativeSurface()!).pointerEvents).toBe("none");
        expect(button()?.disabled).toBe(true);
        button()?.click();
        await Promise.resolve();
        expect(execute).not.toHaveBeenCalled();

        setEditorOwnsPointerInput(false);
        expect(extensionRectCount()).toBe(1);
        expect(surface()?.dataset.editorPointerPassthrough).toBe("false");
        expect(getComputedStyle(surface()!).pointerEvents).toBe("auto");
        expect(getComputedStyle(declarativeSurface()!).pointerEvents).toBe("auto");
        expect(button()?.disabled).toBe(false);
        dispose();
    });
});
