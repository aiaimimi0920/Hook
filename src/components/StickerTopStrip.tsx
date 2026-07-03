import { For, Show, type Component, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";

import {
    resolveSelectedExistingNodePropertyTool,
    resolveStickerTopStripPropertyTool,
    TRANSFORM_MODE_BUTTONS,
} from "./stickerToolbarModel";
import { StickerTopStripPropertyBar } from "./StickerTopStripPropertyBar";
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
    selectedStickerAnnotationId,
    selectedStickerAnnotationIds,
    stickerEditHistories,
    stickerToolSettings,
    uiActions,
} from "../store/uiStore";
import type { StickerAnnotation, StickerCreateTool, StickerToolMode, StickerTransformMode } from "../types/stickerEditing";

interface StickerTopStripProps {
    unitId: string;
    x: number;
    y: number;
    stickerWidth: number;
    stickerHeight: number;
}

interface TopStripIconProps {
    class?: string;
}

type ShapeCreateTool = Extract<
    StickerCreateTool,
    "shape-rect" | "shape-ellipse" | "shape-triangle" | "shape-polygon"
>;
type LabelCreateTool = Extract<StickerCreateTool, "text" | "serial">;
type EffectCreateTool = Extract<StickerCreateTool, "mosaic" | "blur">;
type TopStripCreateTool = ShapeCreateTool | "line" | "brush" | LabelCreateTool | EffectCreateTool;
type TopStripCanvasTool = Extract<StickerToolMode, "crop" | "content-eraser">;
type HistoryActionMode = "undo" | "redo";
type TopStripOpenMenu = "mode" | "shape" | "line" | "label" | "effect" | "history" | "rasterize" | null;

interface TransformModeOption {
    mode: StickerTransformMode;
    label: string;
    shortcut: string;
    Icon: Component<TopStripIconProps>;
}

interface CreateToolOption<TMode extends StickerCreateTool> {
    mode: TMode;
    label: string;
    Icon: Component<TopStripIconProps>;
}

interface HistoryActionOption {
    mode: HistoryActionMode;
    label: string;
    Icon: Component<TopStripIconProps>;
}

interface RasterizeScopeOption {
    mode: StickerRasterizeScope;
    label: string;
    Icon: Component<TopStripIconProps>;
}

const SelectModeIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M6 3.5V19l4.2-3.8 3.1 5.3 2.5-1.5-3.1-5.3 5.8-.6L6 3.5Z" fill="currentColor" stroke="none" />
    </svg>
);

const MoveModeIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3v18" />
        <path d="M12 3l-2.8 2.8" />
        <path d="M12 3l2.8 2.8" />
        <path d="M12 21l-2.8-2.8" />
        <path d="M12 21l2.8-2.8" />
        <path d="M3 12h18" />
        <path d="M3 12l2.8-2.8" />
        <path d="M3 12l2.8 2.8" />
        <path d="M21 12l-2.8-2.8" />
        <path d="M21 12l-2.8 2.8" />
    </svg>
);

const RotateModeIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 10a7 7 0 1 0 1 4" />
        <path d="M20 4v6h-6" />
    </svg>
);

const ScaleModeIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 15 4 20" />
        <path d="M4 16v4h4" />
        <path d="m15 9 5-5" />
        <path d="M16 4h4v4" />
        <path d="m9 9-5-5" />
        <path d="M4 8V4h4" />
        <path d="m15 15 5 5" />
        <path d="M20 16v4h-4" />
    </svg>
);

const RectToolIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <rect x="5" y="6" width="14" height="12" rx="0.5" />
    </svg>
);

const EllipseToolIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <ellipse cx="12" cy="12" rx="7" ry="5.5" />
    </svg>
);

const TriangleToolIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
        <path d="M12 5.5 19 18H5L12 5.5Z" />
    </svg>
);

const PolygonToolIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
        <path d="M12 4.5 18.5 8.5 16.5 17 7.5 17 5.5 8.5 12 4.5Z" />
    </svg>
);

const LineToolIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <path d="M5 18 19 6" />
    </svg>
);

const BrushToolIcon: Component<TopStripIconProps> = (props) => (
    <svg
        class={props.class}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
    >
        <path d="M15.2 4.2 19.8 8.8 9.6 19l-4.4.8.8-4.4L15.2 4.2Z" />
        <path d="M8 15.8c-1.4.3-3 1.4-3 3.4" />
    </svg>
);

const TextToolIcon: Component<TopStripIconProps> = (props) => (
    <svg
        class={props.class}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
    >
        <path d="M5 6h14" />
        <path d="M12 6v12" />
        <path d="M8 18h8" />
    </svg>
);

const SerialToolIcon: Component<TopStripIconProps> = (props) => (
    <svg
        class={props.class}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
    >
        <circle cx="12" cy="12" r="7.5" />
        <path d="M10.2 9.2h1.9v5.6" />
        <path d="M9.7 14.8h3.2" />
    </svg>
);

const MosaicToolIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 24 24" fill="currentColor">
        <rect x="5" y="5" width="5" height="5" rx="0.8" />
        <rect x="11.5" y="5" width="7.5" height="5" rx="0.8" />
        <rect x="5" y="11.5" width="5" height="7.5" rx="0.8" />
        <rect x="11.5" y="11.5" width="7.5" height="7.5" rx="0.8" />
    </svg>
);

const BlurToolIcon: Component<TopStripIconProps> = (props) => (
    <svg
        class={props.class}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
    >
        <circle cx="12" cy="12" r="3.3" />
        <path d="M5 12h2" />
        <path d="M17 12h2" />
        <path d="M12 5v2" />
        <path d="M12 17v2" />
    </svg>
);

const EraserToolIcon: Component<TopStripIconProps> = (props) => (
    <svg
        class={props.class}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
    >
        <path d="M8.5 5h6l4 4-7.5 7.5H6.5L4 14l4.5-9Z" />
        <path d="M11.5 16.5H19" />
    </svg>
);

const CropToolIcon: Component<TopStripIconProps> = (props) => (
    <svg
        class={props.class}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
    >
        <path d="M7 4.5v10.8a2.2 2.2 0 0 0 2.2 2.2H20" />
        <path d="M4.5 7H15a2 2 0 0 1 2 2v10.5" />
        <path d="M10 12.5h6.5" />
        <path d="M12.5 10v5" />
    </svg>
);

const UndoToolIcon: Component<TopStripIconProps> = (props) => (
    <svg
        class={props.class}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
    >
        <path d="M9 7H5v4" />
        <path d="M5 11a8 8 0 1 1 2.4 5.7" />
    </svg>
);

const RedoToolIcon: Component<TopStripIconProps> = (props) => (
    <svg
        class={props.class}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
    >
        <path d="M15 7h4v4" />
        <path d="M19 11a8 8 0 1 0-2.4 5.7" />
    </svg>
);

const RasterizeSelectedToolIcon: Component<TopStripIconProps> = (props) => (
    <svg
        class={props.class}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
    >
        <rect x="4.5" y="5" width="8" height="8" rx="1.2" />
        <path d="M15.5 7.5h4" />
        <path d="M15.5 11h4" />
        <path d="M6.8 15.8h10.4" />
        <path d="M8.2 18.8h7.6" />
    </svg>
);

const RasterizeAllToolIcon: Component<TopStripIconProps> = (props) => (
    <svg
        class={props.class}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
    >
        <rect x="4.5" y="5" width="6.5" height="6.5" rx="1.1" />
        <rect x="13" y="5" width="6.5" height="6.5" rx="1.1" />
        <rect x="4.5" y="13.5" width="6.5" height="6.5" rx="1.1" />
        <rect x="13" y="13.5" width="6.5" height="6.5" rx="1.1" />
    </svg>
);

const ChevronDownCornerIcon: Component<TopStripIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 12 12" fill="currentColor">
        <path d="M2 4.5 6 8l4-3.5H2Z" />
    </svg>
);

const transformModeOptions: TransformModeOption[] = [
    { mode: "select", label: "选择", shortcut: "Q", Icon: SelectModeIcon },
    { mode: "move", label: "移动", shortcut: "W", Icon: MoveModeIcon },
    { mode: "rotate", label: "旋转", shortcut: "E", Icon: RotateModeIcon },
    { mode: "scale", label: "缩放", shortcut: "R", Icon: ScaleModeIcon },
];

const shapeToolOptions: CreateToolOption<ShapeCreateTool>[] = [
    { mode: "shape-rect", label: "矩形", Icon: RectToolIcon },
    { mode: "shape-ellipse", label: "椭圆", Icon: EllipseToolIcon },
    { mode: "shape-triangle", label: "三角形", Icon: TriangleToolIcon },
    { mode: "shape-polygon", label: "多边形", Icon: PolygonToolIcon },
];

const lineToolOptions: CreateToolOption<"line">[] = [
    { mode: "line", label: "直线", Icon: LineToolIcon },
];

const labelToolOptions: CreateToolOption<LabelCreateTool>[] = [
    { mode: "text", label: "文本", Icon: TextToolIcon },
    { mode: "serial", label: "序号", Icon: SerialToolIcon },
];

const effectToolOptions: CreateToolOption<EffectCreateTool>[] = [
    { mode: "mosaic", label: "马赛克", Icon: MosaicToolIcon },
    { mode: "blur", label: "模糊", Icon: BlurToolIcon },
];

const historyActionOptions: HistoryActionOption[] = [
    { mode: "undo", label: "撤销", Icon: UndoToolIcon },
    { mode: "redo", label: "重做", Icon: RedoToolIcon },
];

const rasterizeScopeOptions: RasterizeScopeOption[] = [
    { mode: "selected", label: "栅格化", Icon: RasterizeSelectedToolIcon },
    { mode: "all", label: "栅格化全部", Icon: RasterizeAllToolIcon },
];

const isShapeTool = (value: StickerCreateTool): value is ShapeCreateTool =>
    value === "shape-rect" || value === "shape-ellipse" || value === "shape-triangle" || value === "shape-polygon";

const isLabelTool = (value: StickerCreateTool): value is LabelCreateTool => value === "text" || value === "serial";
const isEffectTool = (value: StickerCreateTool): value is EffectCreateTool => value === "mosaic" || value === "blur";

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
const toolbarMenuClass = "hook-toolbar-menu absolute left-0 top-full z-[1215] mt-1 min-w-[132px]";
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
    const canRasterizeSelected = createMemo(() => {
        const unit = currentUnit();
        if (!unit) return false;

        const existingIds = new Set(unit.data.annotationState?.elements.map((annotation) => annotation.id) || []);
        return selectedAnnotationIds().some((annotationId) => existingIds.has(annotationId));
    });
    const canRasterizeAll = createMemo(() => (currentUnit()?.data.annotationState?.elements.length || 0) > 0);
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
    };

    createEffect(() => {
        if (typeof window === "undefined" || !stripRef) return;

        layout();
        openMenu();

        const rafId = window.requestAnimationFrame(() => {
            if (!stripRef) return;
            addOrUpdateRect(buildStripInteractiveRect(stripRef, props.unitId));
            void syncService.updateBackendRects();
        });

        onCleanup(() => window.cancelAnimationFrame(rafId));
    });

    onCleanup(() => {
        removeRect(`sticker-top-strip-${props.unitId}`);
        void syncService.updateBackendRects();
    });

    return (
        <Portal>
            <div
                ref={stripRef}
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
                                                disabled={!enabled}
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
                                                disabled={!enabled}
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
