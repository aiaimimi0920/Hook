import { Accessor, createEffect, createSignal, onCleanup } from "solid-js";
import { api, isTauriRuntimeAvailable } from "../services/api";
import { getCurrentAppSettings } from "../services/appSettings";
import { buildUnitFileNamingContext, renderFileNamingStem } from "../services/fileNaming";
import { isUnitFormalImagePending } from "../services/graphImageResolution";
import { renderStickerComposite } from "../services/stickerExport";
import {
    NativeDragOverlayPayload,
    resolveNativeDragDropPhysicalPointFromOverlay,
    resolveNativeDragDropPhysicalPointFromPointer,
    resolveNativeDragPreviewPointFromOverlay,
    resolveUnitDragFileUrl,
    resolveUnitDragExportPlan,
} from "../services/unitDragExport";
import { graphStore } from "../store/graphStore";
import type { Unit } from "../types/unit";

type NativeDragPreflightOverlayPayload = NativeDragOverlayPayload & {
    shiftKey?: boolean;
};

export interface UnitNativeStickerDragPreviewModel {
    x: number;
    y: number;
    src: string;
    width: number;
    height: number;
}

interface DragBlobUrlLease {
    target: Element | null;
    dragEndListener: EventListener;
    timeoutId: number | null;
}

interface UnitNativeStickerDragControllerOptions {
    unit: Accessor<Unit>;
    capabilityLabel: Accessor<string | undefined>;
    displaySrc: Accessor<string>;
    element: Accessor<HTMLDivElement | undefined>;
}

/** Owns desktop Shift-drag preflight and the browser HTML5 fallback. */
export const createUnitNativeStickerDragController = (
    options: UnitNativeStickerDragControllerOptions,
) => {
    let nativeStickerDragStart:
        | { x: number; y: number; pointerId?: number; started: boolean }
        | null = null;
    let nativeStickerDragInFlight = false;
    let disposed = false;
    let exportRequestGeneration = 0;
    let preflightSync: Promise<void> = Promise.resolve();
    const dragBlobUrlLeases = new Map<string, DragBlobUrlLease>();
    const [preview, setPreview] = createSignal<UnitNativeStickerDragPreviewModel | null>(null);

    const setNativeDragPreflight = (active: boolean) => {
        preflightSync = preflightSync
            .catch(() => undefined)
            .then(() => api.setNativeStickerDragPreflight(active))
            .catch((error) => {
                console.warn("Failed to synchronize native sticker drag preflight", error);
            });
    };

    const revokeDragBlobUrl = (blobUrl: string) => {
        const lease = dragBlobUrlLeases.get(blobUrl);
        if (!lease) return;
        dragBlobUrlLeases.delete(blobUrl);
        lease.target?.removeEventListener("dragend", lease.dragEndListener);
        if (lease.timeoutId !== null && typeof window !== "undefined") {
            window.clearTimeout(lease.timeoutId);
        }
        URL.revokeObjectURL(blobUrl);
    };

    const retainDragBlobUrl = (blobUrl: string, eventTarget: EventTarget | null) => {
        const target = eventTarget instanceof Element ? eventTarget : null;
        const dragEndListener: EventListener = () => revokeDragBlobUrl(blobUrl);
        const lease: DragBlobUrlLease = { target, dragEndListener, timeoutId: null };
        dragBlobUrlLeases.set(blobUrl, lease);
        target?.addEventListener("dragend", dragEndListener, { once: true });
        if (typeof window !== "undefined") {
            lease.timeoutId = window.setTimeout(() => revokeDragBlobUrl(blobUrl), 60_000);
        }
    };

    const resolveCurrentUnitDragExportPlan = () => {
        const unit = options.unit();
        return resolveUnitDragExportPlan({
            unit,
            capabilityLabel: options.capabilityLabel(),
            displaySrc: options.displaySrc(),
            formalImagePending: isUnitFormalImagePending({
                unitId: unit.id,
                units: graphStore.units,
                links: graphStore.links,
                capabilities: graphStore.capabilities,
            }),
        });
    };

    const detachPendingNativeDragListeners = () => {
        if (typeof window === "undefined") return;
        window.removeEventListener("pointermove", handlePendingNativeDragPointerMove, true);
        window.removeEventListener("mousemove", handlePendingNativeDragPointerMove, true);
        window.removeEventListener("pointerup", handlePendingNativeDragEnd, true);
        window.removeEventListener("mouseup", handlePendingNativeDragEnd, true);
        window.removeEventListener("pointercancel", handlePendingNativeDragEnd, true);
        window.removeEventListener("hook:overlay-native-drag-preflight-move", handlePendingNativeDragOverlayMove as EventListener, true);
        window.removeEventListener("hook:overlay-native-drag-preflight-up", handlePendingNativeDragOverlayEnd as EventListener, true);
    };

    const clearPendingNativeStickerDrag = () => {
        nativeStickerDragStart = null;
        setPreview(null);
        setNativeDragPreflight(false);
        detachPendingNativeDragListeners();
    };

    const pointTargetsThisUnit = (x: number, y: number) => {
        const unitElement = options.element();
        if (!unitElement) return false;
        const target = document.elementFromPoint(x, y);
        if (target instanceof Element) {
            const unitRoot = target.closest(".unit-container");
            if (unitRoot) return unitRoot === unitElement;
        }
        const rect = unitElement.getBoundingClientRect();
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };

    const attachPendingNativeDragListeners = () => {
        if (typeof window === "undefined") return;
        detachPendingNativeDragListeners();
        window.addEventListener("pointermove", handlePendingNativeDragPointerMove, true);
        window.addEventListener("mousemove", handlePendingNativeDragPointerMove, true);
        window.addEventListener("pointerup", handlePendingNativeDragEnd, true);
        window.addEventListener("mouseup", handlePendingNativeDragEnd, true);
        window.addEventListener("pointercancel", handlePendingNativeDragEnd, true);
        window.addEventListener("hook:overlay-native-drag-preflight-move", handlePendingNativeDragOverlayMove as EventListener, true);
        window.addEventListener("hook:overlay-native-drag-preflight-up", handlePendingNativeDragOverlayEnd as EventListener, true);
    };

    const beginPendingHookStickerExportDrag = (x: number, y: number, pointerId?: number) => {
        const exportPlan = resolveCurrentUnitDragExportPlan();
        if (disposed || !exportPlan || nativeStickerDragInFlight) return;
        void api.debugLogEvent(
            "sticker-export-drag-capture",
            `unit=${options.unit().id} x=${x} y=${y} pathFirst=${exportPlan.kind === "path"} exportKind=${exportPlan.kind}`,
        );
        nativeStickerDragStart = { x, y, pointerId, started: false };
        setPreview(null);
        setNativeDragPreflight(true);
        attachPendingNativeDragListeners();
    };

    const beginHookStickerExportDrag = async (globalX: number, globalY: number) => {
        if (disposed || nativeStickerDragInFlight) return;
        nativeStickerDragInFlight = true;
        const requestGeneration = ++exportRequestGeneration;
        try {
            const unit = options.unit();
            const displaySrcAtStart = options.displaySrc();
            const exportPlan = resolveCurrentUnitDragExportPlan();
            if (!exportPlan) return;
            void api.debugLogEvent(
                "sticker-export-drag-request",
                `unit=${unit.id} x=${globalX} y=${globalY} pathFirst=${exportPlan.kind === "path"} exportKind=${exportPlan.kind} hasFilePath=${!!unit.data.filePath} hasDragOutFilePath=${!!unit.data.dragOutFilePath}`,
            );
            let path: string;
            switch (exportPlan.kind) {
                case "path":
                    path = await api.saveStickerDragExportFromPath(
                        exportPlan.path,
                        exportPlan.fileNamingContext,
                        globalX,
                        globalY,
                    );
                    break;
                case "data-url":
                    path = await api.saveStickerDragExport(
                        exportPlan.dataUrl,
                        exportPlan.fileNamingContext,
                        globalX,
                        globalY,
                    );
                    break;
                case "rendered-composite":
                    path = await api.saveStickerDragExport(
                        await renderStickerComposite(unit),
                        exportPlan.fileNamingContext,
                        globalX,
                        globalY,
                    );
                    break;
            }
            const currentUnit = options.unit();
            const currentPlan = resolveCurrentUnitDragExportPlan();
            const planStillCurrent = currentPlan?.kind === exportPlan.kind && (
                exportPlan.kind === "path"
                    ? currentPlan.kind === "path" && currentPlan.path === exportPlan.path
                    : exportPlan.kind === "data-url"
                      ? currentPlan.kind === "data-url" && currentPlan.dataUrl === exportPlan.dataUrl
                      : options.displaySrc() === displaySrcAtStart
            );
            if (
                exportPlan.cacheSavedPath &&
                !disposed &&
                requestGeneration === exportRequestGeneration &&
                currentUnit.id === unit.id &&
                planStillCurrent &&
                graphStore.units.some((candidate) => candidate.id === unit.id)
            ) {
                graphStore.actions.updateUnitData(unit.id, { dragOutFilePath: path });
            }
            void api.debugLogEvent("sticker-export-drag-saved", `unit=${unit.id} path=${path}`);
        } catch (error) {
            console.error("Hook sticker export drag failed", error);
            void api.debugLogEvent(
                "sticker-export-drag-failed",
                `unit=${options.unit().id} error=${error instanceof Error ? error.message : String(error)}`,
            );
        } finally {
            nativeStickerDragInFlight = false;
        }
    };

    const updateHookStickerExportDragPreview = (x: number, y: number) => {
        const start = nativeStickerDragStart;
        if (!start || nativeStickerDragInFlight) return;
        if (!start.started && Math.hypot(x - start.x, y - start.y) < 6) return;
        if (!start.started) {
            start.started = true;
            void api.debugLogEvent("sticker-export-drag-started", `unit=${options.unit().id} x=${x} y=${y}`);
        }
        const unit = options.unit();
        const maxPreviewSize = 140;
        const scale = Math.min(1, maxPreviewSize / Math.max(unit.w, unit.h, 1));
        setPreview({
            x,
            y,
            src: options.displaySrc(),
            width: Math.max(24, unit.w * scale),
            height: Math.max(24, unit.h * scale),
        });
    };

    const handlePendingNativeDragPointerMove = (event: PointerEvent | MouseEvent) => {
        const start = nativeStickerDragStart;
        if (!start || nativeStickerDragInFlight) return;
        if ("pointerId" in event && start.pointerId !== undefined && event.pointerId !== start.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        updateHookStickerExportDragPreview(event.clientX, event.clientY);
    };

    const handlePendingNativeDragOverlayMove = (event: Event) => {
        const start = nativeStickerDragStart;
        if (!start || nativeStickerDragInFlight) return;
        const detail = (event as CustomEvent<NativeDragPreflightOverlayPayload>).detail;
        const point = resolveNativeDragPreviewPointFromOverlay(detail);
        if (point) updateHookStickerExportDragPreview(point.x, point.y);
    };

    const handlePendingNativeDragEnd = (event?: PointerEvent | MouseEvent) => {
        if (
            event &&
            nativeStickerDragStart &&
            "pointerId" in event &&
            nativeStickerDragStart.pointerId !== undefined &&
            event.pointerId !== nativeStickerDragStart.pointerId
        ) return;
        const point = event
            ? resolveNativeDragDropPhysicalPointFromPointer(event, window.devicePixelRatio || 1)
            : null;
        const shouldExport = !!nativeStickerDragStart?.started && !!point;
        clearPendingNativeStickerDrag();
        if (shouldExport && point) void beginHookStickerExportDrag(point.x, point.y);
    };

    const handlePendingNativeDragOverlayDown = (event: Event) => {
        if (!isTauriRuntimeAvailable()) return;
        const detail = (event as CustomEvent<NativeDragPreflightOverlayPayload>).detail;
        if (!detail?.shiftKey) return;
        const point = resolveNativeDragPreviewPointFromOverlay(detail);
        if (!point || !pointTargetsThisUnit(point.x, point.y)) return;
        if (!resolveCurrentUnitDragExportPlan()) return;
        beginPendingHookStickerExportDrag(point.x, point.y);
    };

    const handlePendingNativeDragOverlayEnd = (event?: Event) => {
        const detail = (event as CustomEvent<NativeDragPreflightOverlayPayload> | undefined)?.detail;
        const point = resolveNativeDragDropPhysicalPointFromOverlay(detail);
        const shouldExport = !!nativeStickerDragStart?.started && !!point;
        clearPendingNativeStickerDrag();
        if (shouldExport && point) void beginHookStickerExportDrag(point.x, point.y);
    };

    const handleNativeStickerPointerDownCapture = (event: PointerEvent) => {
        if (!isTauriRuntimeAvailable() || !event.shiftKey) return;
        if (!resolveCurrentUnitDragExportPlan()) return;
        event.preventDefault();
        event.stopPropagation();
        beginPendingHookStickerExportDrag(event.clientX, event.clientY, event.pointerId);
    };

    const handleBrowserImageDragStart = (e: DragEvent) => {
        if (isTauriRuntimeAvailable()) {
            e.preventDefault();
            return;
        }
        if (!e.shiftKey) {
            e.preventDefault();
            return;
        }
        const dataTransfer = e.dataTransfer;
        if (!dataTransfer) {
            e.preventDefault();
            return;
        }
        dataTransfer.effectAllowed = "all";
        dataTransfer.clearData();
        const unit = options.unit();
        const appSettings = getCurrentAppSettings();
        const namingContext = buildUnitFileNamingContext(unit, options.capabilityLabel());
        const filename = `${renderFileNamingStem(
            appSettings.fileNaming.dragExportPattern,
            namingContext,
            appSettings.fileNaming,
        )}.png`;
        const exportPlan = resolveCurrentUnitDragExportPlan();
        const src = exportPlan?.kind === "data-url"
            ? exportPlan.dataUrl
            : unit.type === "art"
              ? ""
              : unit.data.previewSrc || unit.data.src || "";
        const dragOutFilePath = exportPlan?.kind === "path" ? exportPlan.path : undefined;

        if (dragOutFilePath) {
            const fileUrl = resolveUnitDragFileUrl(dragOutFilePath);
            if (!fileUrl) {
                e.preventDefault();
                return;
            }
            const dlUrl = `image/png:${filename}:${fileUrl}`;
            dataTransfer.setData("DownloadURL", dlUrl);
            dataTransfer.setData("text/uri-list", fileUrl);
            dataTransfer.setData("text/plain", dragOutFilePath);
            return;
        }
        if (src.startsWith("data:")) {
            const separatorIndex = src.indexOf(",");
            const metadata = separatorIndex > 5 ? src.slice(5, separatorIndex) : "";
            if (!metadata.toLowerCase().endsWith(";base64")) {
                console.warn("Skipped malformed image data URL during drag export");
                e.preventDefault();
                return;
            }
            const declaredMime = metadata.slice(0, -";base64".length);
            const mime = /^image\/[a-z0-9.+-]+$/i.test(declaredMime) ? declaredMime : "image/png";
            try {
                const byteString = atob(src.slice(separatorIndex + 1));
                const ab = new ArrayBuffer(byteString.length);
                const ia = new Uint8Array(ab);
                for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
                const blobUrl = URL.createObjectURL(new Blob([ab], { type: mime }));
                retainDragBlobUrl(blobUrl, e.currentTarget);
                const dlUrl = `${mime}:${filename}:${blobUrl}`;
                dataTransfer.setData("DownloadURL", dlUrl);
            } catch (err) {
                console.error("Failed to create blob for drag:", err);
                e.preventDefault();
                return;
            }
            dataTransfer.setData("text/uri-list", src);
        }
    };

    createEffect(() => {
        if (typeof window === "undefined") return;
        const unitElement = options.element();
        unitElement?.addEventListener("pointerdown", handleNativeStickerPointerDownCapture, true);
        window.addEventListener("hook:overlay-native-drag-preflight-down", handlePendingNativeDragOverlayDown as EventListener, true);
        onCleanup(() => {
            unitElement?.removeEventListener("pointerdown", handleNativeStickerPointerDownCapture, true);
            window.removeEventListener("hook:overlay-native-drag-preflight-down", handlePendingNativeDragOverlayDown as EventListener, true);
            clearPendingNativeStickerDrag();
        });
    });

    onCleanup(() => {
        disposed = true;
        exportRequestGeneration += 1;
        clearPendingNativeStickerDrag();
        Array.from(dragBlobUrlLeases.keys()).forEach(revokeDragBlobUrl);
    });

    return {
        browserDragEnabled: () => !isTauriRuntimeAvailable(),
        handleBrowserImageDragStart,
        preview,
    };
};
