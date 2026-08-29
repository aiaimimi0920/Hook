import { surfaceStore } from "../store/surfaceStore";
import { AppListenerRegistry } from "./appListenerRegistry";
import { extensionBridgeClient } from "./extensionBridgeClient";
import { extensionRegistry } from "./extensionRegistry";
import { extensionSurfaceDiagnostics } from "./extensionSurfaceDiagnostics";
import { extensionVisualRegistry } from "./extensionVisualRegistry";
import { extraRects } from "./uiRegistry";

export const extensionHostDiagnostics = () => {
    const bridge = extensionBridgeClient.diagnostics();
    const registry = extensionRegistry.diagnostics();
    const visuals = extensionVisualRegistry.diagnostics();
    const extensionSurfaces = extensionSurfaceDiagnostics();
    const nativeRects = extraRects();
    return {
        registry,
        visuals,
        nativeHitRects: nativeRects.length,
        extensionHitRects: nativeRects.filter((rect) => rect.name === "EXTENSION_OVERLAY").length,
        surfaceInstances: Object.keys(surfaceStore.byUnit).length + extensionSurfaces.mountedInstances,
        extensionSurfaceInstances: extensionSurfaces.mountedInstances,
        listeners: AppListenerRegistry.diagnostics().activeDisposers + registry.listeners,
        timers: bridge.pendingRequests + bridge.reconnectTimers,
        bridge,
    };
};
