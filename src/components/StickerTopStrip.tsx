import { Show, type Component, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";

import {
    resolveSelectedExistingNodePropertyTool,
    resolveStickerTopStripPropertyTool,
} from "./stickerToolbarModel";
import { StickerTopStripPropertyBar } from "./StickerTopStripPropertyBar";
import {
    isEffectTool,
    isLabelTool,
    isShapeTool,
    type EffectCreateTool,
    type HistoryActionMode,
    type LabelCreateTool,
    type ShapeCreateTool,
    type TopStripCreateTool,
} from "./stickerTopStripCatalog";
import { StickerTopStripCreateTools } from "./StickerTopStripCreateTools";
import { StickerTopStripEditActions } from "./StickerTopStripEditActions";
import { StickerTopStripOcrTools } from "./StickerTopStripOcrTools";
import { StickerTopStripSurfaceView } from "./StickerTopStripSurfaceView";
import type { TopStripOpenMenu } from "./stickerTopStripChrome";
import { buildStickerTopStripInteractiveRect } from "./stickerTopStripInteractiveRect";
import {
    computeStickerTopStripLayout,
    STICKER_TOP_STRIP_HEIGHT,
} from "../services/stickerTopStripLayout";
import { graphStore } from "../store/graphStore";
import { captureStickerEditSnapshot } from "../services/stickerHistory";
import type { StickerRasterizeScope } from "../services/stickerRasterize";
import { rasterizeStickerAnnotationsForUnit } from "../services/stickerRasterizeActions";
import { createSingleFlightAction } from "../services/singleFlightAction";
import { copyCachedOcrFullText, resolveCachedOcrFullText } from "../services/ocrResultActions";
import { syncTopStripBackendRects } from "../services/stickerTopStripSync";
import { syncService } from "../services/syncService";
import { addOrUpdateRect, removeRect } from "../services/uiRegistry";
import {
    draggingStickerId,
    selectedStickerAnnotationId,
    selectedStickerAnnotationIds,
    stickerEditHistories,
    stickerToolSettings,
    uiActions,
} from "../store/uiStore";
import type { StickerAnnotation, StickerToolMode, StickerTransformMode } from "../types/stickerEditing";
import {
    registerDragFollowerElement,
    unregisterDragFollowerElement,
} from "../services/dragFollowerRegistry";
import type { SurfaceViewDefinition } from "../services/surfaceProtocol";

interface StickerTopStripProps {
    unitId: string;
    x: number;
    y: number;
    stickerWidth: number;
    stickerHeight: number;
    supportsBitmapTools?: boolean;
    isArt?: boolean;
    surfaceViews?: readonly SurfaceViewDefinition[];
    selectedSurfaceViewId?: string;
    onSurfaceViewChange?: (viewId: string) => void;
}

type TopStripCanvasTool = Extract<StickerToolMode, "crop" | "content-eraser">;
const getViewportSize = () => {
    if (typeof window === "undefined") {
        return { width: 1440, height: 900 };
    }

    return {
        width: Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0, 320),
        height: Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0, 320),
    };
};

export const StickerTopStrip: Component<StickerTopStripProps> = (props) => {
    const [viewport, setViewport] = createSignal(getViewportSize());
    const [openMenu, setOpenMenu] = createSignal<TopStripOpenMenu>(null);
    const [currentShapeTool, setCurrentShapeTool] = createSignal<ShapeCreateTool>("shape-rect");
    const [currentLabelTool, setCurrentLabelTool] = createSignal<LabelCreateTool>("text");
    const [currentEffectTool, setCurrentEffectTool] = createSignal<EffectCreateTool>("mosaic");
    const [currentHistoryAction, setCurrentHistoryAction] = createSignal<HistoryActionMode>("undo");
    const [currentRasterizeScope, setCurrentRasterizeScope] = createSignal<StickerRasterizeScope>("selected");
    const [historyActionPending, setHistoryActionPending] = createSignal(false);
    const [rasterizeActionPending, setRasterizeActionPending] = createSignal(false);
    const historyActionGate = createSingleFlightAction(setHistoryActionPending);
    const rasterizeActionGate = createSingleFlightAction(setRasterizeActionPending);
    let stripRef: HTMLDivElement | undefined;
    let dragFollowerRegistration: { unitId: string; element: HTMLDivElement } | null = null;
    const openMenuRectId = () => `sticker-top-strip-menu-${props.unitId}`;
    let openMenuRectSyncRafIds: number[] = [];

    const syncDragFollowerRegistration = () => {
        const element = stripRef;
        const unitId = props.unitId;
        const registration = dragFollowerRegistration;

        if (registration && (registration.unitId !== unitId || registration.element !== element)) {
            unregisterDragFollowerElement(registration.unitId, registration.element);
            dragFollowerRegistration = null;
        }
        if (!element || dragFollowerRegistration) return;

        registerDragFollowerElement(unitId, element);
        dragFollowerRegistration = { unitId, element };
    };

    createEffect(syncDragFollowerRegistration);

    const syncOpenToolbarMenuRect = (
        menu: TopStripOpenMenu,
        menuRectId: string,
        stripElement: HTMLDivElement | undefined,
    ) => {
        if (!menu || !stripElement) return false;
        const menuElement = stripElement.querySelector<HTMLElement>("[data-top-strip-menu='true']");
        if (!menuElement) return false;

        const bounds = menuElement.getBoundingClientRect();
        addOrUpdateRect({
            id: menuRectId,
            x: bounds.left,
            y: bounds.top,
            width: bounds.width,
            height: bounds.height,
            name: "STICKER_TOP_STRIP_MENU",
        });
        syncTopStripBackendRects();
        return true;
    };

    const cancelOpenToolbarMenuRectSync = () => {
        for (const rafId of openMenuRectSyncRafIds) {
            window.cancelAnimationFrame(rafId);
        }
        openMenuRectSyncRafIds = [];
    };

    const scheduleOpenToolbarMenuRectSync = (menu: TopStripOpenMenu, menuRectId: string) => {
        if (typeof window === "undefined") return;
        cancelOpenToolbarMenuRectSync();
        const stripElement = stripRef;

        const scheduleFrame = (remainingFrames: number) => {
            const rafId = window.requestAnimationFrame(() => {
                openMenuRectSyncRafIds = openMenuRectSyncRafIds.filter((item) => item !== rafId);
                if (!syncOpenToolbarMenuRect(menu, menuRectId, stripElement) && remainingFrames > 0) {
                    scheduleFrame(remainingFrames - 1);
                }
            });
            openMenuRectSyncRafIds.push(rafId);
        };

        scheduleFrame(3);
    };

    createEffect(() => {
        if (typeof window === "undefined") return;
        const updateViewport = () => setViewport(getViewportSize());
        updateViewport();
        window.addEventListener("resize", updateViewport);
        onCleanup(() => window.removeEventListener("resize", updateViewport));
    });

    createEffect(() => {
        const activeTool = stickerToolSettings.activeTool;
        if (!isShapeTool(activeTool)) return;
        setCurrentShapeTool(activeTool);
    });

    createEffect(() => {
        const activeTool = stickerToolSettings.activeTool;
        if (!isLabelTool(activeTool)) return;
        setCurrentLabelTool(activeTool);
    });

    createEffect(() => {
        const activeTool = stickerToolSettings.activeTool;
        if (!isEffectTool(activeTool)) return;
        setCurrentEffectTool(activeTool);
    });

    createEffect(() => {
        if (typeof window === "undefined" || !openMenu()) return;
        const closeOnOutsidePointer = (event: PointerEvent) => {
            if (stripRef?.contains(event.target as Node)) return;
            setOpenMenu(null);
        };
        window.addEventListener("pointerdown", closeOnOutsidePointer);
        onCleanup(() => window.removeEventListener("pointerdown", closeOnOutsidePointer));
    });

    createEffect(() => {
        if (typeof window === "undefined") return;
        const menu = openMenu();

        if (!menu) {
            cancelOpenToolbarMenuRectSync();
            return;
        }

        const menuRectId = openMenuRectId();
        scheduleOpenToolbarMenuRectSync(menu, menuRectId);
        const handleResize = () => scheduleOpenToolbarMenuRectSync(menu, menuRectId);
        window.addEventListener("resize", handleResize);

        onCleanup(() => {
            cancelOpenToolbarMenuRectSync();
            window.removeEventListener("resize", handleResize);
            removeRect(menuRectId);
            syncTopStripBackendRects();
        });
    });

    const currentTransformMode = createMemo<StickerTransformMode>(() => stickerToolSettings.transformMode);
    const isModeSelected = createMemo(() => stickerToolSettings.domain === "existing");
    const isShapeSelected = createMemo(
        () => stickerToolSettings.domain === "create" && isShapeTool(stickerToolSettings.activeTool),
    );
    const isLineSelected = createMemo(
        () => stickerToolSettings.domain === "create" && stickerToolSettings.activeTool === "line",
    );
    const isBrushSelected = createMemo(
        () =>
            stickerToolSettings.domain === "create" &&
            (stickerToolSettings.activeTool === "brush" || stickerToolSettings.activeTool === "highlighter"),
    );
    const isLabelSelected = createMemo(
        () => stickerToolSettings.domain === "create" && isLabelTool(stickerToolSettings.activeTool),
    );
    const isEffectSelected = createMemo(
        () => stickerToolSettings.domain === "create" && isEffectTool(stickerToolSettings.activeTool),
    );
    const isEraserSelected = createMemo(
        () => stickerToolSettings.domain === "sticker" && stickerToolSettings.activeCanvasTool === "content-eraser",
    );
    const isCropSelected = createMemo(
        () => stickerToolSettings.domain === "sticker" && stickerToolSettings.activeCanvasTool === "crop",
    );
    const historyState = createMemo(() => stickerEditHistories[props.unitId]);
    const canUndo = createMemo(() => (historyState()?.past?.length || 0) > 0);
    const canRedo = createMemo(() => (historyState()?.future?.length || 0) > 0);
    const isHistoryEnabled = createMemo(
        () => !historyActionPending() && (currentHistoryAction() === "undo" ? canUndo() : canRedo()),
    );
    const currentUnit = createMemo(() => graphStore.units.find((item) => item.id === props.unitId));
    const selectedAnnotationIds = createMemo(() => {
        if (selectedStickerAnnotationIds.length > 0) {
            return [...selectedStickerAnnotationIds];
        }
        return selectedStickerAnnotationId() ? [selectedStickerAnnotationId()!] : [];
    });
    const selectedExistingAnnotationType = createMemo<StickerAnnotation["type"] | null>(() => {
        const annotationIds = selectedAnnotationIds();
        if (annotationIds.length !== 1) return null;
        const annotation = currentUnit()?.data.annotationState?.elements.find((item) => item.id === annotationIds[0]);
        return annotation?.type ?? null;
    });
    const propertyBarTool = createMemo(() => {
        const selectedExistingTool = resolveSelectedExistingNodePropertyTool(
            stickerToolSettings.domain,
            selectedExistingAnnotationType(),
            selectedAnnotationIds().length,
        );
        if (selectedExistingTool) return selectedExistingTool;

        const tool = resolveStickerTopStripPropertyTool(
            stickerToolSettings.domain,
            stickerToolSettings.activeTool,
            stickerToolSettings.activeCanvasTool,
        );
        return tool;
    });
    const layout = createMemo(() =>
        computeStickerTopStripLayout(
            {
                x: props.x,
                y: props.y,
                w: props.stickerWidth,
                h: props.stickerHeight,
            },
            viewport().width,
            viewport().height,
            !!propertyBarTool(),
        ),
    );
    const draggingThisSticker = createMemo(() => draggingStickerId() === props.unitId);
    const canRasterizeSelected = createMemo(() => {
        const unit = currentUnit();
        if (!unit) return false;

        const existingIds = new Set(unit.data.annotationState?.elements?.map((annotation) => annotation.id) || []);
        return selectedAnnotationIds().some((annotationId) => existingIds.has(annotationId));
    });
    const canRasterizeAll = createMemo(() => (currentUnit()?.data.annotationState?.elements?.length || 0) > 0);
    const isRasterizeEnabled = createMemo(() =>
        !rasterizeActionPending() &&
        (currentRasterizeScope() === "selected" ? canRasterizeSelected() : canRasterizeAll()),
    );

    const toggleMenu = (menu: Exclude<TopStripOpenMenu, null>) => {
        setOpenMenu((current) => (current === menu ? null : menu));
    };

    const applyTransformMode = (mode: StickerTransformMode) => {
        uiActions.setStickerTransformMode(mode);
        setOpenMenu(null);
    };

    const applyCreateTool = (mode: TopStripCreateTool) => {
        if (isShapeTool(mode)) {
            setCurrentShapeTool(mode);
        }
        if (isLabelTool(mode)) {
            setCurrentLabelTool(mode);
        }
        if (isEffectTool(mode)) {
            setCurrentEffectTool(mode);
        }
        uiActions.setStickerEditMode(mode);
        setOpenMenu(null);
    };

    const applyTopStripTool = (mode: TopStripCreateTool | TopStripCanvasTool) => {
        if (mode === "content-eraser" || mode === "crop") {
            uiActions.setStickerEditMode(mode);
            setOpenMenu(null);
            return;
        }

        applyCreateTool(mode);
    };

    const applySnapshot = async (
        unitId: string,
        snapshot: ReturnType<typeof captureStickerEditSnapshot> | undefined,
    ) => {
        if (!snapshot) return;
        graphStore.actions.restoreStickerEditSnapshot(unitId, snapshot);
        graphStore.actions.propagateStickerEditsFrom(unitId);
        await syncService.performWorkflowSync();
    };

    const runHistoryAction = async (mode: HistoryActionMode) => {
        const unitId = props.unitId;
        const unit = currentUnit();
        const undoAvailable = canUndo();
        const redoAvailable = canRedo();
        try {
            await historyActionGate.run(async () => {
                if (!unit) return;

                if (mode === "undo") {
                    if (!undoAvailable) return;
                    await applySnapshot(
                        unitId,
                        uiActions.undoStickerHistory(
                            unitId,
                            captureStickerEditSnapshot(unit, { includeImageData: true }),
                        ),
                    );
                    return;
                }

                if (!redoAvailable) return;
                await applySnapshot(
                    unitId,
                    uiActions.redoStickerHistory(
                        unitId,
                        captureStickerEditSnapshot(unit, { includeImageData: true }),
                    ),
                );
            });
        } catch (error) {
            console.error("[Hook] Failed to apply sticker history action", error);
        }
    };

    const runRasterizeAction = async (scope: StickerRasterizeScope) => {
        const unitId = props.unitId;
        const unit = currentUnit();
        const selectedAnnotationId = selectedStickerAnnotationId();
        const selectedIds = selectedAnnotationIds();
        // The rasterize pipeline loads images and reads canvases back via
        // toDataURL, either of which can reject (decode failure, tainted canvas).
        // This runs from a void-invoked click handler, so guard it here rather
        // than relying solely on the global unhandledrejection net.
        try {
            await rasterizeActionGate.run(async () => {
                if (!unit) return;

                const rasterized = await rasterizeStickerAnnotationsForUnit({
                    unitId,
                    currentUnit: unit,
                    scope,
                    selectedAnnotationId,
                    selectedAnnotationIds: selectedIds,
                });
                if (rasterized) {
                    uiActions.setSelectedStickerAnnotation(null);
                }
            });
        } catch (error) {
            console.error("[Hook] Failed to rasterize sticker annotations", error);
        }
    };

    createEffect(() => {
        if (typeof window === "undefined" || !stripRef) return;

        layout();
        openMenu();
        if (draggingThisSticker()) return;
        const currentUnitId = props.unitId;

        const rafId = window.requestAnimationFrame(() => {
            if (!stripRef) return;
            addOrUpdateRect(buildStickerTopStripInteractiveRect(stripRef, currentUnitId));
            syncTopStripBackendRects();
        });

        onCleanup(() => window.cancelAnimationFrame(rafId));
    });

    onCleanup(() => {
        historyActionGate.dispose();
        rasterizeActionGate.dispose();
        removeRect(`sticker-top-strip-${props.unitId}`);
        removeRect(openMenuRectId());
        const registration = dragFollowerRegistration;
        if (registration) {
            unregisterDragFollowerElement(registration.unitId, registration.element);
            dragFollowerRegistration = null;
        }
        syncTopStripBackendRects();
    });

    return (
        <Portal>
            <div
                ref={(element) => {
                    stripRef = element;
                    syncDragFollowerRegistration();
                }}
                data-hook-drag-follow-unit-id={props.unitId}
                class="hook-terminal-shell hook-terminal-shell--strong pointer-events-none fixed z-[1210] box-border"
                style={{
                    left: `${layout().container.left}px`,
                    top: `${layout().container.top}px`,
                    width: `${layout().container.width}px`,
                    height: `${layout().container.height}px`,
                }}
            >
                <Show when={propertyBarTool()}>
                    {(tool) => <StickerTopStripPropertyBar unitId={props.unitId} tool={tool()} />}
                </Show>

                <div
                    class="pointer-events-auto flex items-stretch"
                    style={{
                        height: `${STICKER_TOP_STRIP_HEIGHT}px`,
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <StickerTopStripCreateTools
                        openMenu={openMenu()}
                        currentTransformMode={currentTransformMode()}
                        currentShapeTool={currentShapeTool()}
                        currentLabelTool={currentLabelTool()}
                        currentEffectTool={currentEffectTool()}
                        isModeSelected={isModeSelected()}
                        isShapeSelected={isShapeSelected()}
                        isLineSelected={isLineSelected()}
                        isBrushSelected={isBrushSelected()}
                        isLabelSelected={isLabelSelected()}
                        isEffectSelected={isEffectSelected()}
                        supportsBitmapTools={props.supportsBitmapTools !== false}
                        onToggleMenu={toggleMenu}
                        onTransformMode={applyTransformMode}
                        onCreateTool={applyCreateTool}
                    />
                    <StickerTopStripEditActions
                        openMenu={openMenu()}
                        supportsBitmapTools={props.supportsBitmapTools !== false}
                        isArt={props.isArt === true}
                        isEraserSelected={isEraserSelected()}
                        isCropSelected={isCropSelected()}
                        currentHistoryAction={currentHistoryAction()}
                        isHistoryEnabled={isHistoryEnabled()}
                        canUndo={!historyActionPending() && canUndo()}
                        canRedo={!historyActionPending() && canRedo()}
                        currentRasterizeScope={currentRasterizeScope()}
                        isRasterizeEnabled={isRasterizeEnabled()}
                        canRasterizeSelected={!rasterizeActionPending() && canRasterizeSelected()}
                        canRasterizeAll={!rasterizeActionPending() && canRasterizeAll()}
                        onToggleMenu={toggleMenu}
                        onCanvasTool={applyTopStripTool}
                        onHistoryAction={(mode) => void runHistoryAction(mode)}
                        onSelectHistoryAction={(mode) => {
                            setCurrentHistoryAction(mode);
                            setOpenMenu(null);
                        }}
                        onRasterize={(scope) => void runRasterizeAction(scope)}
                        onSelectRasterizeScope={(scope) => {
                            setCurrentRasterizeScope(scope);
                            setOpenMenu(null);
                        }}
                    />
                    <StickerTopStripOcrTools
                        openMenu={openMenu()}
                        canCopyFullText={!!resolveCachedOcrFullText(currentUnit())}
                        onToggleMenu={toggleMenu}
                        onCopyFullText={() => {
                            setOpenMenu(null);
                            void copyCachedOcrFullText(props.unitId);
                        }}
                    />
                    <StickerTopStripSurfaceView
                        isArt={props.isArt === true}
                        openMenu={openMenu()}
                        surfaceViews={props.surfaceViews ?? []}
                        selectedSurfaceViewId={props.selectedSurfaceViewId}
                        onToggleMenu={toggleMenu}
                        onSurfaceViewChange={(viewId) => {
                            props.onSurfaceViewChange?.(viewId);
                            setOpenMenu(null);
                        }}
                    />
                </div>
            </div>
        </Portal>
    );
};
