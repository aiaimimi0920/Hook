import { For, Show, type Component, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";

import {
    resolveSelectedExistingNodePropertyTool,
    resolveStickerTopStripPropertyTool,
    TRANSFORM_MODE_BUTTONS,
} from "./stickerToolbarModel";
import { StickerTopStripPropertyBar } from "./StickerTopStripPropertyBar";
import {
    effectToolOptions,
    historyActionOptions,
    isEffectTool,
    isLabelTool,
    isShapeTool,
    labelToolOptions,
    lineToolOptions,
    rasterizeScopeOptions,
    shapeToolOptions,
    transformModeOptions,
    type EffectCreateTool,
    type HistoryActionMode,
    type LabelCreateTool,
    type ShapeCreateTool,
    type TopStripCreateTool,
} from "./stickerTopStripCatalog";
import {
    BrushToolIcon,
    ChevronDownCornerIcon,
    CropToolIcon,
    EraserToolIcon,
    LineToolIcon,
} from "./stickerTopStripIcons";
import {
    computeStickerTopStripLayout,
    STICKER_TOP_STRIP_HEIGHT,
} from "../services/stickerTopStripLayout";
import { graphStore } from "../store/graphStore";
import { captureStickerEditSnapshot } from "../services/stickerHistory";
import type { StickerRasterizeScope } from "../services/stickerRasterize";
import { rasterizeStickerAnnotationsForUnit } from "../services/stickerRasterizeActions";
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

interface StickerTopStripProps {
    unitId: string;
    x: number;
    y: number;
    stickerWidth: number;
    stickerHeight: number;
}

type TopStripCanvasTool = Extract<StickerToolMode, "crop" | "content-eraser">;
type TopStripOpenMenu = "mode" | "shape" | "line" | "label" | "effect" | "history" | "rasterize" | null;

const getViewportSize = () => {
    if (typeof window === "undefined") {
        return { width: 1440, height: 900 };
    }

    return {
        width: Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0, 320),
        height: Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0, 320),
    };
};

const buildStripInteractiveRect = (root: HTMLDivElement, unitId: string) => {
    const rootBounds = root.getBoundingClientRect();
    let left = rootBounds.left;
    let top = rootBounds.top;
    let right = rootBounds.right;
    let bottom = rootBounds.bottom;

    root.querySelectorAll<HTMLElement>("button, input, select, [data-top-strip-menu='true']").forEach((element) => {
        const bounds = element.getBoundingClientRect();
        left = Math.min(left, bounds.left);
        top = Math.min(top, bounds.top);
        right = Math.max(right, bounds.right);
        bottom = Math.max(bottom, bounds.bottom);
    });

    return {
        id: `sticker-top-strip-${unitId}`,
        x: left,
        y: top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
        name: "STICKER_TOP_STRIP",
    };
};

const toolbarButtonClass = "hook-toolbar-button flex h-[50px] w-[50px] items-center justify-center pb-1 pr-1 text-white transition-colors";
const toolbarButtonRightBorderClass = `${toolbarButtonClass} border-r border-white/15`;
const toolbarButtonLeftBorderClass = `${toolbarButtonClass} border-l border-white/15`;
const toolbarCornerToggleClass =
    "hook-toolbar-corner-toggle absolute bottom-0 right-0 z-10 flex h-6 w-6 items-center justify-center border-l border-t border-white/15 transition-colors";
const toolbarMenuClass = "hook-toolbar-menu pointer-events-auto absolute left-0 top-full z-[1215] mt-1 min-w-[132px]";
const toolbarMenuItemClass = "hook-toolbar-menu-item flex h-10 w-full items-center gap-2 px-3 text-left text-[12px] transition-colors";

export const StickerTopStrip: Component<StickerTopStripProps> = (props) => {
    const [viewport, setViewport] = createSignal(getViewportSize());
    const [openMenu, setOpenMenu] = createSignal<TopStripOpenMenu>(null);
    const [currentShapeTool, setCurrentShapeTool] = createSignal<ShapeCreateTool>("shape-rect");
    const [currentLabelTool, setCurrentLabelTool] = createSignal<LabelCreateTool>("text");
    const [currentEffectTool, setCurrentEffectTool] = createSignal<EffectCreateTool>("mosaic");
    const [currentHistoryAction, setCurrentHistoryAction] = createSignal<HistoryActionMode>("undo");
    const [currentRasterizeScope, setCurrentRasterizeScope] = createSignal<StickerRasterizeScope>("selected");
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
        void syncService.updateBackendRects();
        return true;
    };

    const cancelOpenToolbarMenuRectSync = () => {
        for (const rafId of openMenuRectSyncRafIds) {
            window.cancelAnimationFrame(rafId);
        }
        openMenuRectSyncRafIds = [];
    };

    const scheduleOpenToolbarMenuRectSync = (menu: TopStripOpenMenu) => {
        if (typeof window === "undefined") return;
        cancelOpenToolbarMenuRectSync();
        const stripElement = stripRef;
        const menuRectId = openMenuRectId();

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

        scheduleOpenToolbarMenuRectSync(menu);
        const handleResize = () => scheduleOpenToolbarMenuRectSync(menu);
        window.addEventListener("resize", handleResize);

        onCleanup(() => {
            cancelOpenToolbarMenuRectSync();
            window.removeEventListener("resize", handleResize);
            removeRect(openMenuRectId());
            void syncService.updateBackendRects();
        });
    });

    const currentTransformMode = createMemo<StickerTransformMode>(() => stickerToolSettings.transformMode);
    const currentTransformOption = createMemo(
        () => transformModeOptions.find((item) => item.mode === currentTransformMode()) ?? transformModeOptions[0],
    );
    const currentShapeOption = createMemo(
        () => shapeToolOptions.find((item) => item.mode === currentShapeTool()) ?? shapeToolOptions[0],
    );
    const currentLabelOption = createMemo(
        () => labelToolOptions.find((item) => item.mode === currentLabelTool()) ?? labelToolOptions[0],
    );
    const currentEffectOption = createMemo(
        () => effectToolOptions.find((item) => item.mode === currentEffectTool()) ?? effectToolOptions[0],
    );
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
    const currentHistoryOption = createMemo(
        () => historyActionOptions.find((item) => item.mode === currentHistoryAction()) ?? historyActionOptions[0],
    );
    const isHistoryEnabled = createMemo(() => (currentHistoryAction() === "undo" ? canUndo() : canRedo()));
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

        return resolveStickerTopStripPropertyTool(
            stickerToolSettings.domain,
            stickerToolSettings.activeTool,
            stickerToolSettings.activeCanvasTool,
        );
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
    const currentRasterizeOption = createMemo(
        () => rasterizeScopeOptions.find((item) => item.mode === currentRasterizeScope()) ?? rasterizeScopeOptions[0],
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
        currentRasterizeScope() === "selected" ? canRasterizeSelected() : canRasterizeAll(),
    );

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

    const applySnapshot = async (snapshot: ReturnType<typeof captureStickerEditSnapshot> | undefined) => {
        if (!snapshot) return;
        graphStore.actions.restoreStickerEditSnapshot(props.unitId, snapshot);
        graphStore.actions.propagateStickerEditsFrom(props.unitId);
        await syncService.performWorkflowSync();
    };

    const runHistoryAction = async (mode: HistoryActionMode) => {
        const unit = currentUnit();
        if (!unit) return;

        if (mode === "undo") {
            if (!canUndo()) return;
            await applySnapshot(
                uiActions.undoStickerHistory(props.unitId, captureStickerEditSnapshot(unit, { includeImageData: true })),
            );
            return;
        }

        if (!canRedo()) return;
        await applySnapshot(
            uiActions.redoStickerHistory(props.unitId, captureStickerEditSnapshot(unit, { includeImageData: true })),
        );
    };

    const runRasterizeAction = async (scope: StickerRasterizeScope) => {
        const unit = currentUnit();
        if (!unit) return;

        // The rasterize pipeline loads images and reads canvases back via
        // toDataURL, either of which can reject (decode failure, tainted canvas).
        // This runs from a void-invoked click handler, so guard it here rather
        // than relying solely on the global unhandledrejection net.
        try {
            const rasterized = await rasterizeStickerAnnotationsForUnit({
                unitId: props.unitId,
                currentUnit: unit,
                scope,
                selectedAnnotationId: selectedStickerAnnotationId(),
                selectedAnnotationIds: selectedAnnotationIds(),
            });
            if (rasterized) {
                uiActions.setSelectedStickerAnnotation(null);
            }
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
            addOrUpdateRect(buildStripInteractiveRect(stripRef, currentUnitId));
            void syncService.updateBackendRects();
        });

        onCleanup(() => window.cancelAnimationFrame(rafId));
    });

    onCleanup(() => {
        removeRect(`sticker-top-strip-${props.unitId}`);
        removeRect(openMenuRectId());
        const registration = dragFollowerRegistration;
        if (registration) {
            unregisterDragFollowerElement(registration.unitId, registration.element);
            dragFollowerRegistration = null;
        }
        void syncService.updateBackendRects();
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
                    <div class="relative h-[50px] w-[50px]" onPointerDown={(event) => event.stopPropagation()}>
                        <button
                            type="button"
                            class={toolbarButtonRightBorderClass}
                            classList={{
                                "hook-toolbar-button--active": isModeSelected(),
                                "bg-white/5 hover:bg-white/10": !isModeSelected(),
                            }}
                            aria-label={`${currentTransformOption().label}模式`}
                            title={`${currentTransformOption().label} (${currentTransformOption().shortcut})`}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() => applyTransformMode(currentTransformMode())}
                        >
                            {(() => {
                                const Icon = currentTransformOption().Icon;
                                return <Icon class="h-7 w-7" />;
                            })()}
                        </button>
                        <button
                            type="button"
                            class={toolbarCornerToggleClass}
                            aria-label="展开模式列表"
                            title="展开模式列表"
                            onPointerDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                            }}
                            onClick={(event) => {
                                event.stopPropagation();
                                setOpenMenu((current) => (current === "mode" ? null : "mode"));
                            }}
                        >
                            <ChevronDownCornerIcon class="h-3 w-3" />
                        </button>
                        <Show when={openMenu() === "mode"}>
                            <div
                                class={toolbarMenuClass}
                                data-top-strip-menu="true"
                                onPointerMove={(event) => event.stopPropagation()}
                                onWheel={(event) => event.stopPropagation()}
                            >
                                <For each={TRANSFORM_MODE_BUTTONS}>
                                    {(item) => {
                                        const option = transformModeOptions.find((candidate) => candidate.mode === item.mode) ?? transformModeOptions[0];
                                        return (
                                            <button
                                                type="button"
                                                class={toolbarMenuItemClass}
                                                classList={{
                                                    "hook-toolbar-menu-item--active": currentTransformMode() === item.mode,
                                                    "hover:bg-white/10": currentTransformMode() !== item.mode,
                                                }}
                                                onClick={() => applyTransformMode(item.mode)}
                                            >
                                                <option.Icon class="h-4 w-4 shrink-0" />
                                                <span>{item.label}</span>
                                                <span class="ml-auto text-[10px] text-white/40">{item.shortcut}</span>
                                            </button>
                                        );
                                    }}
                                </For>
                            </div>
                        </Show>
                    </div>

                    <div class="relative h-[50px] w-[50px]" onPointerDown={(event) => event.stopPropagation()}>
                        <button
                            type="button"
                            class={toolbarButtonRightBorderClass}
                            classList={{
                                "hook-toolbar-button--active": isShapeSelected(),
                                "bg-white/5 hover:bg-white/10": !isShapeSelected(),
                            }}
                            aria-label={`${currentShapeOption().label}图形工具`}
                            title={currentShapeOption().label}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() => applyCreateTool(currentShapeTool())}
                        >
                            {(() => {
                                const Icon = currentShapeOption().Icon;
                                return <Icon class="h-7 w-7" />;
                            })()}
                        </button>
                        <button
                            type="button"
                            class={toolbarCornerToggleClass}
                            aria-label="展开图形列表"
                            title="展开图形列表"
                            onPointerDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                            }}
                            onClick={(event) => {
                                event.stopPropagation();
                                setOpenMenu((current) => (current === "shape" ? null : "shape"));
                            }}
                        >
                            <ChevronDownCornerIcon class="h-3 w-3" />
                        </button>
                        <Show when={openMenu() === "shape"}>
                            <div
                                class={toolbarMenuClass}
                                data-top-strip-menu="true"
                                onPointerMove={(event) => event.stopPropagation()}
                                onWheel={(event) => event.stopPropagation()}
                            >
                                <For each={shapeToolOptions}>
                                    {(item) => (
                                        <button
                                            type="button"
                                            class={toolbarMenuItemClass}
                                            classList={{
                                                "hook-toolbar-menu-item--active": currentShapeTool() === item.mode,
                                                "hover:bg-white/10": currentShapeTool() !== item.mode,
                                            }}
                                            onClick={() => applyCreateTool(item.mode)}
                                        >
                                            <item.Icon class="h-4 w-4 shrink-0" />
                                            <span>{item.label}</span>
                                        </button>
                                    )}
                                </For>
                            </div>
                        </Show>
                    </div>

                    <div class="relative h-[50px] w-[50px]" onPointerDown={(event) => event.stopPropagation()}>
                        <button
                            type="button"
                            class={toolbarButtonClass}
                            classList={{
                                "hook-toolbar-button--active": isLineSelected(),
                                "bg-white/5 hover:bg-white/10": !isLineSelected(),
                            }}
                            aria-label="直线工具"
                            title="直线"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() => applyCreateTool("line")}
                        >
                            <LineToolIcon class="h-7 w-7" />
                        </button>
                        <button
                            type="button"
                            class={toolbarCornerToggleClass}
                            aria-label="展开直线列表"
                            title="展开直线列表"
                            onPointerDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                            }}
                            onClick={(event) => {
                                event.stopPropagation();
                                setOpenMenu((current) => (current === "line" ? null : "line"));
                            }}
                        >
                            <ChevronDownCornerIcon class="h-3 w-3" />
                        </button>
                        <Show when={openMenu() === "line"}>
                            <div
                                class={toolbarMenuClass}
                                data-top-strip-menu="true"
                                onPointerMove={(event) => event.stopPropagation()}
                                onWheel={(event) => event.stopPropagation()}
                            >
                                <For each={lineToolOptions}>
                                    {(item) => (
                                        <button
                                            type="button"
                                            class={toolbarMenuItemClass}
                                            classList={{
                                                "hook-toolbar-menu-item--active": isLineSelected(),
                                                "hover:bg-white/10": !isLineSelected(),
                                            }}
                                            onClick={() => applyCreateTool(item.mode)}
                                        >
                                            <item.Icon class="h-4 w-4 shrink-0" />
                                            <span>{item.label}</span>
                                        </button>
                                    )}
                                </For>
                            </div>
                        </Show>
                    </div>

                    <div class="relative h-[50px] w-[50px]" onPointerDown={(event) => event.stopPropagation()}>
                        <button
                            type="button"
                            class={toolbarButtonRightBorderClass}
                            classList={{
                                "hook-toolbar-button--active": isBrushSelected(),
                                "bg-white/5 hover:bg-white/10": !isBrushSelected(),
                            }}
                            aria-label="画笔工具"
                            title="画笔"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() => applyCreateTool("brush")}
                        >
                            <BrushToolIcon class="h-7 w-7" />
                        </button>
                    </div>

                    <div class="relative h-[50px] w-[50px]" onPointerDown={(event) => event.stopPropagation()}>
                        <button
                            type="button"
                            class={toolbarButtonClass}
                            classList={{
                                "hook-toolbar-button--active": isLabelSelected(),
                                "bg-white/5 hover:bg-white/10": !isLabelSelected(),
                            }}
                            aria-label={`${currentLabelOption().label}标记工具`}
                            title={currentLabelOption().label}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() => applyCreateTool(currentLabelTool())}
                        >
                            {(() => {
                                const Icon = currentLabelOption().Icon;
                                return <Icon class="h-7 w-7" />;
                            })()}
                        </button>
                        <button
                            type="button"
                            class={toolbarCornerToggleClass}
                            aria-label="展开文字标记列表"
                            title="展开文字标记列表"
                            onPointerDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                            }}
                            onClick={(event) => {
                                event.stopPropagation();
                                setOpenMenu((current) => (current === "label" ? null : "label"));
                            }}
                        >
                            <ChevronDownCornerIcon class="h-3 w-3" />
                        </button>
                        <Show when={openMenu() === "label"}>
                            <div
                                class={toolbarMenuClass}
                                data-top-strip-menu="true"
                                onPointerMove={(event) => event.stopPropagation()}
                                onWheel={(event) => event.stopPropagation()}
                            >
                                <For each={labelToolOptions}>
                                    {(item) => (
                                        <button
                                            type="button"
                                            class={toolbarMenuItemClass}
                                            classList={{
                                                "hook-toolbar-menu-item--active": currentLabelTool() === item.mode,
                                                "hover:bg-white/10": currentLabelTool() !== item.mode,
                                            }}
                                            onClick={() => applyCreateTool(item.mode)}
                                        >
                                            <item.Icon class="h-4 w-4 shrink-0" />
                                            <span>{item.label}</span>
                                        </button>
                                    )}
                                </For>
                            </div>
                        </Show>
                    </div>

                    <div class="relative h-[50px] w-[50px]" onPointerDown={(event) => event.stopPropagation()}>
                        <button
                            type="button"
                            class={toolbarButtonClass}
                            classList={{
                                "hook-toolbar-button--active": isEffectSelected(),
                                "bg-white/5 hover:bg-white/10": !isEffectSelected(),
                            }}
                            aria-label={`${currentEffectOption().label}效果工具`}
                            title={currentEffectOption().label}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() => applyCreateTool(currentEffectTool())}
                        >
                            {(() => {
                                const Icon = currentEffectOption().Icon;
                                return <Icon class="h-7 w-7" />;
                            })()}
                        </button>
                        <button
                            type="button"
                            class={toolbarCornerToggleClass}
                            aria-label="展开效果列表"
                            title="展开效果列表"
                            onPointerDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                            }}
                            onClick={(event) => {
                                event.stopPropagation();
                                setOpenMenu((current) => (current === "effect" ? null : "effect"));
                            }}
                        >
                            <ChevronDownCornerIcon class="h-3 w-3" />
                        </button>
                        <Show when={openMenu() === "effect"}>
                            <div
                                class={toolbarMenuClass}
                                data-top-strip-menu="true"
                                onPointerMove={(event) => event.stopPropagation()}
                                onWheel={(event) => event.stopPropagation()}
                            >
                                <For each={effectToolOptions}>
                                    {(item) => (
                                        <button
                                            type="button"
                                            class={toolbarMenuItemClass}
                                            classList={{
                                                "hook-toolbar-menu-item--active": currentEffectTool() === item.mode,
                                                "hover:bg-white/10": currentEffectTool() !== item.mode,
                                            }}
                                            onClick={() => applyCreateTool(item.mode)}
                                        >
                                            <item.Icon class="h-4 w-4 shrink-0" />
                                            <span>{item.label}</span>
                                        </button>
                                    )}
                                </For>
                            </div>
                        </Show>
                    </div>

                    <div class="relative h-[50px] w-[50px]" onPointerDown={(event) => event.stopPropagation()}>
                        <button
                            type="button"
                            class={toolbarButtonLeftBorderClass}
                            classList={{
                                "hook-toolbar-button--active": isEraserSelected(),
                                "bg-white/5 hover:bg-white/10": !isEraserSelected(),
                            }}
                            aria-label="橡皮擦工具"
                            title="橡皮擦"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() => applyTopStripTool("content-eraser")}
                        >
                            <EraserToolIcon class="h-7 w-7" />
                        </button>
                    </div>

                    <div class="relative h-[50px] w-[50px]" onPointerDown={(event) => event.stopPropagation()}>
                        <button
                            type="button"
                            class={toolbarButtonLeftBorderClass}
                            classList={{
                                "hook-toolbar-button--active": isCropSelected(),
                                "bg-white/5 hover:bg-white/10": !isCropSelected(),
                            }}
                            aria-label="裁剪工具"
                            title="裁剪"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() => applyTopStripTool("crop")}
                        >
                            <CropToolIcon class="h-7 w-7" />
                        </button>
                    </div>

                    <div class="relative h-[50px] w-[50px]" onPointerDown={(event) => event.stopPropagation()}>
                        <button
                            type="button"
                            class={toolbarButtonLeftBorderClass}
                            classList={{
                                "bg-white/5 hover:bg-white/10": isHistoryEnabled(),
                                "bg-white/5 text-white/35": !isHistoryEnabled(),
                            }}
                            aria-label={currentHistoryOption().label}
                            title={currentHistoryOption().label}
                            disabled={!isHistoryEnabled()}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() => void runHistoryAction(currentHistoryAction())}
                        >
                            {(() => {
                                const Icon = currentHistoryOption().Icon;
                                return <Icon class="h-7 w-7" />;
                            })()}
                        </button>
                        <button
                            type="button"
                            class={toolbarCornerToggleClass}
                            aria-label="展开历史操作列表"
                            title="展开历史操作列表"
                            onPointerDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                            }}
                            onClick={(event) => {
                                event.stopPropagation();
                                setOpenMenu((current) => (current === "history" ? null : "history"));
                            }}
                        >
                            <ChevronDownCornerIcon class="h-3 w-3" />
                        </button>
                        <Show when={openMenu() === "history"}>
                            <div
                                class={toolbarMenuClass}
                                data-top-strip-menu="true"
                                onPointerMove={(event) => event.stopPropagation()}
                                onWheel={(event) => event.stopPropagation()}
                            >
                                <For each={historyActionOptions}>
                                    {(item) => {
                                        const enabled = item.mode === "undo" ? canUndo() : canRedo();
                                        return (
                                            <button
                                                type="button"
                                                class={toolbarMenuItemClass}
                                                classList={{
                                                    "hook-toolbar-menu-item--active": currentHistoryAction() === item.mode,
                                                    "text-white/85 hover:bg-white/10": currentHistoryAction() !== item.mode && enabled,
                                                    "text-white/35": !enabled,
                                                }}
                                                onClick={() => {
                                                    setCurrentHistoryAction(item.mode);
                                                    setOpenMenu(null);
                                                }}
                                            >
                                                <item.Icon class="h-4 w-4 shrink-0" />
                                                <span>{item.label}</span>
                                            </button>
                                        );
                                    }}
                                </For>
                            </div>
                        </Show>
                    </div>

                    <div class="relative h-[50px] w-[50px]" onPointerDown={(event) => event.stopPropagation()}>
                        <button
                            type="button"
                            class={toolbarButtonLeftBorderClass}
                            classList={{
                                "bg-white/5 hover:bg-white/10": isRasterizeEnabled(),
                                "bg-white/5 text-white/35": !isRasterizeEnabled(),
                            }}
                            aria-label={currentRasterizeOption().label}
                            title={currentRasterizeOption().label}
                            disabled={!isRasterizeEnabled()}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() => void runRasterizeAction(currentRasterizeScope())}
                        >
                            {(() => {
                                const Icon = currentRasterizeOption().Icon;
                                return <Icon class="h-7 w-7" />;
                            })()}
                        </button>
                        <button
                            type="button"
                            class={toolbarCornerToggleClass}
                            aria-label="展开栅格化列表"
                            title="展开栅格化列表"
                            onPointerDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                            }}
                            onClick={(event) => {
                                event.stopPropagation();
                                setOpenMenu((current) => (current === "rasterize" ? null : "rasterize"));
                            }}
                        >
                            <ChevronDownCornerIcon class="h-3 w-3" />
                        </button>
                        <Show when={openMenu() === "rasterize"}>
                            <div
                                class={toolbarMenuClass}
                                data-top-strip-menu="true"
                                onPointerMove={(event) => event.stopPropagation()}
                                onWheel={(event) => event.stopPropagation()}
                            >
                                <For each={rasterizeScopeOptions}>
                                    {(item) => {
                                        const enabled = item.mode === "selected" ? canRasterizeSelected() : canRasterizeAll();
                                        return (
                                            <button
                                                type="button"
                                                class={toolbarMenuItemClass}
                                                classList={{
                                                    "hook-toolbar-menu-item--active": currentRasterizeScope() === item.mode,
                                                    "text-white/85 hover:bg-white/10": currentRasterizeScope() !== item.mode && enabled,
                                                    "text-white/35": !enabled,
                                                }}
                                                onClick={() => {
                                                    setCurrentRasterizeScope(item.mode);
                                                    setOpenMenu(null);
                                                }}
                                            >
                                                <item.Icon class="h-4 w-4 shrink-0" />
                                                <span>{item.label}</span>
                                            </button>
                                        );
                                    }}
                                </For>
                            </div>
                        </Show>
                    </div>
                </div>
            </div>
        </Portal>
    );
};
