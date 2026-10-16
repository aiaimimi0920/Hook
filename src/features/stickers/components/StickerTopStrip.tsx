import { Show, type Component, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import "../styles/sticker-edit-strip.css";

import {
    resolveSelectedExistingNodePropertyTool,
    resolveStickerTopStripPropertyTool,
} from "./stickerToolbarModel";
import { StickerTopStripPropertyBar } from "./StickerTopStripPropertyBar";
import { StickerSettings } from "./StickerSettings";
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
import { StickerTopStripTextActions } from "./StickerTopStripTextActions";
import { StickerTopStripSurfaceView } from "./StickerTopStripSurfaceView";
import { ExtensionToolbarItems } from "../../extensions/components/ExtensionToolbarItems";
import { extensionPresentationStore } from "../../extensions/services/extensionPresentationStore";
import { visibleStickerExtensionToolbarSlots } from "../services/stickerExtensionToolbar";
import { type TopStripOpenMenu } from "./stickerTopStripChrome";
import { buildStickerTopStripInteractiveRect } from "./stickerTopStripInteractiveRect";
import { syncOpenToolbarMenuRect } from "./stickerTopStripMenuPosition";
import { createStickerTopStripHover } from "./stickerTopStripHover";
import { installStickerTopStripLongPress } from "./stickerTopStripLongPress";
import {
    computeStickerTopStripLayout,
} from "../services/stickerTopStripLayout";
import { graphStore } from "../../workspace/state/graphStore";
import { captureStickerEditSnapshot } from "../services/stickerHistory";
import type { StickerRasterizeScope } from "../services/stickerRasterize";
import { rasterizeStickerAnnotationsForUnit } from "../services/stickerRasterizeActions";
import { createSingleFlightAction } from "../../../shared/async/singleFlightAction";
import { syncTopStripBackendRects } from "../services/stickerTopStripSync";
import { syncService } from "../../workspace/services/syncService";
import { addOrUpdateRect, removeRect } from "../../../platform/desktop/uiRegistry";
import {
    draggingStickerId,
    selectedStickerAnnotationId,
    selectedStickerAnnotationIds,
    stickerEditHistories,
    stickerToolSettings,
    uiActions,
} from "../../workspace/state/uiStore";
import type { StickerAnnotation, StickerToolMode, StickerTransformMode } from "../types/stickerEditing";
import {
    registerDragFollowerElement,
    unregisterDragFollowerElement,
} from "../../workspace/services/dragFollowerRegistry";
import type { SurfaceViewDefinition } from "../../surfaces/services/surfaceProtocol";

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
    const toolbarHover = createStickerTopStripHover();
    const [currentShapeTool, setCurrentShapeTool] = createSignal<ShapeCreateTool>("shape-rect");
    const [currentLineTool, setCurrentLineTool] = createSignal<"line" | "bezier">(stickerToolSettings.activeTool === "bezier" ? "bezier" : "line");
    const [currentBrushTool, setCurrentBrushTool] = createSignal<"brush" | "paintbrush">(stickerToolSettings.activeTool === "paintbrush" ? "paintbrush" : "brush");
    const [currentLabelTool, setCurrentLabelTool] = createSignal<LabelCreateTool>("text");
    const [currentEffectTool, setCurrentEffectTool] = createSignal<EffectCreateTool>("mosaic");
    const [currentRasterizeScope, setCurrentRasterizeScope] = createSignal<StickerRasterizeScope>("selected");
    const [historyActionPending, setHistoryActionPending] = createSignal(false);
    const [rasterizeActionPending, setRasterizeActionPending] = createSignal(false);
    const historyActionGate = createSingleFlightAction(setHistoryActionPending);
    const rasterizeActionGate = createSingleFlightAction(setRasterizeActionPending);
    let stripRef: HTMLDivElement | undefined;
    let mainBarRef: HTMLDivElement | undefined;
    let disposeLongPress: (() => void) | undefined;
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
        if (isShapeTool(activeTool)) setCurrentShapeTool(activeTool);
        if (isLabelTool(activeTool)) setCurrentLabelTool(activeTool);
        if (isEffectTool(activeTool)) setCurrentEffectTool(activeTool);
        if (activeTool === "line" || activeTool === "bezier") setCurrentLineTool(activeTool);
        if (activeTool === "brush" || activeTool === "paintbrush") setCurrentBrushTool(activeTool);
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
        // Capture the registration owned by this effect so cleanup removes its original rect.
        const initialMenu = openMenu();
        layout();

        if (!initialMenu) {
            cancelOpenToolbarMenuRectSync();
            return;
        }

        const initialMenuRectId = openMenuRectId();
        scheduleOpenToolbarMenuRectSync(initialMenu, initialMenuRectId);
        const handleResize = () => scheduleOpenToolbarMenuRectSync(initialMenu, initialMenuRectId);
        window.addEventListener("resize", handleResize);

        onCleanup(() => {
            cancelOpenToolbarMenuRectSync();
            window.removeEventListener("resize", handleResize);
            removeRect(initialMenuRectId);
            syncTopStripBackendRects();
        });
    });

    const currentTransformMode = createMemo<StickerTransformMode>(() => stickerToolSettings.transformMode);
    const isModeSelected = createMemo(() => stickerToolSettings.domain === "existing");
    const isShapeSelected = createMemo(
        () => stickerToolSettings.domain === "create" && isShapeTool(stickerToolSettings.activeTool),
    );
    const isLineSelected = createMemo(
        () => stickerToolSettings.domain === "create" && (stickerToolSettings.activeTool === "line" || stickerToolSettings.activeTool === "bezier"),
    );
    const isBrushSelected = createMemo(
        () =>
            stickerToolSettings.domain === "create" &&
            (stickerToolSettings.activeTool === "brush" || stickerToolSettings.activeTool === "paintbrush" || stickerToolSettings.activeTool === "highlighter"),
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
    const extensionToolbarSlots = createMemo(() => visibleStickerExtensionToolbarSlots(
        extensionPresentationStore.toolbarItems(),
    ));
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
            extensionToolbarSlots().length + (props.supportsBitmapTools !== false || props.isArt ? 1 : 0),
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
        if (mode === "bezier" || mode === "line") uiActions.setSelectedStickerAnnotation(null);
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
            console.error("[Otter] Failed to apply sticker history action", error);
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
            console.error("[Otter] Failed to rasterize sticker annotations", error);
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
        toolbarHover.clear();
        disposeLongPress?.();
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

    const editActions = (section: "control" | "canvas") => (
        <StickerTopStripEditActions
            section={section}
            openMenu={openMenu()}
            supportsBitmapTools={props.supportsBitmapTools !== false}
            isArt={props.isArt === true}
            isEraserSelected={isEraserSelected()}
            isCropSelected={isCropSelected()}
            canUndo={!historyActionPending() && canUndo()}
            canRedo={!historyActionPending() && canRedo()}
            currentRasterizeScope={currentRasterizeScope()}
            isRasterizeEnabled={isRasterizeEnabled()}
            canRasterizeSelected={!rasterizeActionPending() && canRasterizeSelected()}
            canRasterizeAll={!rasterizeActionPending() && canRasterizeAll()}
            onToggleMenu={toggleMenu}
            onCanvasTool={applyTopStripTool}
            onHistoryAction={(mode) => void runHistoryAction(mode)}
            onRasterize={(scope) => void runRasterizeAction(scope)}
            onSelectRasterizeScope={(scope) => {
                setCurrentRasterizeScope(scope);
                setOpenMenu(null);
            }}
        />
    );

    return (
        <Portal ref={() => {
            // Portal 的 ref 在插入真实文档后执行，子元素的 ref 则可能仍在模板文档中。
            disposeLongPress?.();
            if (mainBarRef) disposeLongPress = installStickerTopStripLongPress(mainBarRef);
        }}>
            <div
                ref={(element) => {
                    stripRef = element;
                    syncDragFollowerRegistration();
                }}
                data-otter-drag-follow-unit-id={props.unitId}
                class="pointer-events-none fixed z-[1210] box-border"
                style={{
                    left: `${layout().container.left}px`,
                    top: `${layout().container.top}px`,
                    width: `${layout().container.width}px`,
                    height: `${layout().container.height}px`,
                }}
            >
                <Show when={propertyBarTool()} keyed>
                    {(tool) => <StickerTopStripPropertyBar unitId={props.unitId} tool={tool} anchorFrame={layout().mainBar} />}
                </Show>

                <div
                    class="otter-edit-strip pointer-events-auto flex flex-wrap content-start items-stretch [&>*]:shrink-0"
                    ref={(element) => { mainBarRef = element; }}
                    role="toolbar"
                    aria-label="贴图编辑"
                    onPointerOver={toolbarHover.over}
                    onPointerOut={toolbarHover.out}
                    style={{
                        width: `${layout().mainBar.width}px`,
                        height: `${layout().mainBar.height}px`,
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <StickerSettings unitId={props.unitId} x={props.x} y={props.y} width={props.stickerWidth} height={props.stickerHeight}
                        available={props.supportsBitmapTools !== false || props.isArt === true}
                        onOpen={() => setOpenMenu(null)} />
                    <StickerTopStripCreateTools
                        controlActions={<>
                            {editActions("control")}
                            <StickerTopStripTextActions unitId={props.unitId} onActivate={() => setOpenMenu(null)} />
                        </>}
                        canvasActions={editActions("canvas")}
                        openMenu={openMenu()}
                        currentTransformMode={currentTransformMode()}
                        currentShapeTool={currentShapeTool()}
                        currentLineTool={currentLineTool()}
                        currentBrushTool={currentBrushTool()}
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
                    <ExtensionToolbarItems
                        open={openMenu() === "extension"}
                        onOpenChange={(open) => setOpenMenu(open ? "extension" : null)}
                    />
                </div>
            </div>
        </Portal>
    );
};
