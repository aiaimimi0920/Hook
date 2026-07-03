import { For, Show, createMemo, createSignal, type Component } from "solid-js";
import { Portal } from "solid-js/web";

import { ColorPicker } from "./ColorPicker";
import { graphStore } from "../store/graphStore";
import {
    getResetColorForSlot,
    getShapeFillColorKey,
    getShapeStrokeColorKey,
    PAINT_COLOR_SETTING_KEYS,
    type NumericToolSettingKey,
    type ShapeColorSettingKey,
    type StickerTopStripPropertyTool,
} from "./stickerToolbarModel";
import { updateTextAnnotationFontFamilyById } from "../services/stickerAnnotationMutations";
import {
    computeRestoredCropFrame,
    DEFAULT_STICKER_PALETTE,
    normalizeStickerPaletteColor,
    scaleStickerFrame,
    toggleStickerBorder,
} from "../services/stickerEditing";
import { captureStickerEditSnapshot } from "../services/stickerHistory";
import { flipRasterizedAnnotationLayer } from "../services/stickerBitmapLayers";
import { flipStickerEditDataForFrame } from "../services/stickerEditTransforms";
import { mergeStickerFontFamilies } from "../services/fontCatalog";
import { syncService } from "../services/syncService";
import {
    installedStickerFonts,
    selectedStickerAnnotationId,
    selectedStickerAnnotationIds,
    stickerColorState,
    stickerToolSettings,
    uiActions,
} from "../store/uiStore";
import type { StickerTextAnnotation, StickerToolSettings } from "../types/stickerEditing";

interface StickerTopStripPropertyBarProps {
    unitId: string;
    tool: StickerTopStripPropertyTool;
}

interface AnchorRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface MiniIconProps {
    class?: string;
}

type SelectedExistingColorRole =
    | "selected-text-color"
    | "selected-serial-foreground"
    | "selected-serial-fill";

const iconShellClass =
    "flex h-6 shrink-0 items-center justify-center border border-white/10 bg-black/35 text-white/80 transition-colors hover:border-white/25 hover:bg-white/10";
const groupedShellClass =
    "flex h-6 shrink-0 items-center gap-0.5 border border-white/10 bg-black/35 px-0.5 text-white/85";
const compactInputClass =
    "h-4 w-[28px] bg-transparent text-center text-[10px] text-white outline-none placeholder:text-white/30";
const compactSelectClass =
    "h-5 border border-white/10 bg-black/30 px-0.5 text-[10px] text-white outline-none";

const dashOptions: Array<{ key: "solid" | "dash-1" | "dash-2"; label: string; title: string }> = [
    { key: "solid", label: "━", title: "实线" },
    { key: "dash-1", label: "╌", title: "虚线1" },
    { key: "dash-2", label: "┄", title: "虚线2" },
];

const StrokeColorIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
        <rect x="3" y="3" width="10" height="10" rx="1.2" />
    </svg>
);

const FillColorIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="currentColor">
        <rect x="3" y="3" width="10" height="10" rx="1.2" />
    </svg>
);

const ConstraintIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="10" height="10" rx="1.4" />
        <path d="M5.5 8h5" />
        <path d="M8 5.5v5" />
    </svg>
);

const SquareConstraintGlyphIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none">
        <text
            x="8"
            y="11"
            fill="currentColor"
            font-size="10"
            font-weight="700"
            text-anchor="middle"
        >
            正
        </text>
    </svg>
);

const StepIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 11.5 6 8.5 8 10 12.5 5.5" />
        <path d="M12.5 5.5V8.5" />
    </svg>
);

const LineWidthIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round">
        <path d="M3 12.5h10" stroke-width="2.4" />
        <path d="M3 8h10" stroke-width="1.5" />
        <path d="M3 4h10" stroke-width="0.9" />
    </svg>
);

const AngleSnapIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 12V4h8" />
        <path d="M4 12 12 4" />
        <path d="M6.5 12A2.5 2.5 0 0 0 4 9.5" />
    </svg>
);

const ArrowHeadIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 12 12 3" />
        <path d="M8.5 3H12v3.5" />
    </svg>
);

const BrushIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.5 3.5 13 6l-5.5 5.5-2.5.5.5-2.5L10.5 3.5Z" />
        <path d="M5.5 10.5c-.7.2-1.5.8-1.5 1.8" />
    </svg>
);

const HighlighterGlowIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 3.2v2" />
        <path d="M11.4 4.6 10 6" />
        <path d="M12.8 8h-2" />
        <path d="M5.8 9.6 9.6 5.8 12.2 8.4 8.4 12.2H5.6Z" />
        <path d="M4.2 12.6h4.2" />
    </svg>
);

const TextIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 4h10" />
        <path d="M8 4v8" />
        <path d="M5.5 12h5" />
    </svg>
);

const RadiusIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 12V6a2 2 0 0 1 2-2h6" />
        <path d="M6 12h6" />
        <path d="M12 4v4" />
    </svg>
);

const PolygonSidesIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="8,2.5 12.5,5 12.5,11 8,13.5 3.5,11 3.5,5" />
        <circle cx="8" cy="2.5" r="0.6" fill="currentColor" stroke="none" />
        <circle cx="12.5" cy="5" r="0.6" fill="currentColor" stroke="none" />
        <circle cx="12.5" cy="11" r="0.6" fill="currentColor" stroke="none" />
        <circle cx="8" cy="13.5" r="0.6" fill="currentColor" stroke="none" />
        <circle cx="3.5" cy="11" r="0.6" fill="currentColor" stroke="none" />
        <circle cx="3.5" cy="5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
);

const BlurIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
        <circle cx="8" cy="8" r="2.3" />
        <path d="M3 8h1.2M11.8 8H13" />
        <path d="M8 3v1.2M8 11.8V13" />
    </svg>
);

const MosaicIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="currentColor">
        <rect x="3" y="3" width="4" height="4" rx="0.5" />
        <rect x="8.5" y="3" width="4.5" height="4" rx="0.5" />
        <rect x="3" y="8.5" width="4" height="4.5" rx="0.5" />
        <rect x="8.5" y="8.5" width="4.5" height="4.5" rx="0.5" />
    </svg>
);

const EraserIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6.2 4.2h4.2l2.1 2.1-5.4 5.5H3.9L2.5 10.4 6.2 4.2Z" />
        <path d="M8 11.8h4.5" />
    </svg>
);

const AnnotationsOnlyFocusedIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" opacity="0.35" />
        <rect x="4.2" y="4.2" width="5.2" height="5.2" rx="0.9" stroke-dasharray="1.1 1.1" />
        <path d="M10.3 9.8 12.9 7.2" />
        <path d="M10.7 6.8h1.7l.8.8-2.5 2.5H9.9l-.6-.6 1.4-2.7Z" />
    </svg>
);

const FlipXIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 2.8v10.4" />
        <path d="m6.1 5.3-2.8 2.8 2.8 2.8" />
        <path d="m9.9 5.3 2.8 2.8-2.8 2.8" />
    </svg>
);

const FlipYIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2.8 8h10.4" />
        <path d="m5.3 6.1 2.8-2.8 2.8 2.8" />
        <path d="m5.3 9.9 2.8 2.8 2.8-2.8" />
    </svg>
);

const ResetCropIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4.5 3.5h7v7" />
        <path d="M11.5 12.5h-7v-7" />
        <path d="M5 5 3 7l2 2" />
    </svg>
);

const OpacityIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 2.7 11.8 6.8A4.8 4.8 0 1 1 4.2 6.8L8 2.7Z" />
        <path d="M8 4.8v6.5" opacity="0.55" />
    </svg>
);

const CanvasSizeIcon: Component<MiniIconProps> = (props) => (
    <svg class={props.class} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="10" height="8" rx="1.2" />
        <path d="M5 8h6" />
        <path d="M9 6l2 2-2 2" />
    </svg>
);

export const StickerTopStripPropertyBar: Component<StickerTopStripPropertyBarProps> = (props) => {
    const [numericDrafts, setNumericDrafts] = createSignal<Partial<Record<NumericToolSettingKey, string>>>({});
    const [activeColorSlot, setActiveColorSlot] = createSignal<ShapeColorSettingKey | null>(null);
    const [selectedExistingColorRole, setSelectedExistingColorRole] = createSignal<SelectedExistingColorRole | null>(null);
    const [colorPickerAnchor, setColorPickerAnchor] = createSignal<AnchorRect | null>(null);
    const [pickerInitialColor, setPickerInitialColor] = createSignal<string | null>(null);
    const [cropOpacityDraft, setCropOpacityDraft] = createSignal<string | null>(null);
    const [cropCanvasWidthDraft, setCropCanvasWidthDraft] = createSignal<string | null>(null);
    const [cropCornerRadiusDraft, setCropCornerRadiusDraft] = createSignal<string | null>(null);
    const [selectedTextSizeDraft, setSelectedTextSizeDraft] = createSignal<string | null>(null);
    const [selectedSerialRadiusDraft, setSelectedSerialRadiusDraft] = createSignal<string | null>(null);

    const isShapeTool = createMemo(
        () =>
            props.tool === "shape-rect" ||
            props.tool === "shape-round-rect" ||
            props.tool === "shape-ellipse" ||
            props.tool === "shape-triangle" ||
            props.tool === "shape-polygon",
    );
    const isLineTool = createMemo(() => props.tool === "line" || props.tool === "arrow");
    const isBrushTool = createMemo(() => props.tool === "brush" || props.tool === "highlighter");
    const isTextTool = createMemo(() => props.tool === "text");
    const isSerialTool = createMemo(() => props.tool === "serial");
    const isEffectTool = createMemo(() => props.tool === "mosaic" || props.tool === "blur");
    const isEraserTool = createMemo(() => props.tool === "content-eraser");
    const isPolygonTool = createMemo(() => props.tool === "shape-polygon");
    const supportsCornerRadius = createMemo(
        () =>
            props.tool === "shape-rect" ||
            props.tool === "shape-round-rect" ||
            props.tool === "shape-triangle" ||
            props.tool === "shape-polygon",
    );
    const supportsFillColor = createMemo(
        () =>
            props.tool === "shape-rect" ||
            props.tool === "shape-round-rect" ||
            props.tool === "shape-ellipse" ||
            props.tool === "shape-triangle" ||
            props.tool === "shape-polygon",
    );
    const shapeStrokeColorSlot = createMemo<ShapeColorSettingKey>(() => {
        switch (props.tool) {
            case "shape-ellipse":
            case "shape-triangle":
            case "shape-polygon":
            case "shape-rect":
            case "shape-round-rect":
            case "line":
            case "arrow":
                return getShapeStrokeColorKey(props.tool);
            default:
                return "rectStrokeColor";
        }
    });
    const shapeFillColorSlot = createMemo<ShapeColorSettingKey | null>(() => {
        switch (props.tool) {
            case "shape-ellipse":
            case "shape-triangle":
            case "shape-polygon":
            case "shape-rect":
            case "shape-round-rect":
                return getShapeFillColorKey(props.tool);
            default:
                return null;
        }
    });
    const availableFontFamilies = createMemo(() => mergeStickerFontFamilies(installedStickerFonts()));
    const unit = createMemo(() => graphStore.units.find((item) => item.id === props.unitId));
    const selectedExistingTextAnnotation = createMemo(() => {
        const annotationId = selectedStickerAnnotationId();
        if (!annotationId || selectedStickerAnnotationIds.length !== 1) return undefined;
        const annotation = unit()?.data.annotationState?.elements.find((item) => item.id === annotationId);
        return annotation && (annotation.type === "text" || annotation.type === "serial") ? annotation : undefined;
    });
    const selectedExistingTextFontFamily = createMemo(() => {
        const annotation = selectedExistingTextAnnotation();
        if (annotation?.type === "text") {
            return annotation.fontFamily || stickerToolSettings.textFontFamily;
        }
        return stickerToolSettings.textFontFamily;
    });
    const selectedExistingTextSize = createMemo(() => {
        const annotation = selectedExistingTextAnnotation();
        if (annotation?.type === "text") {
            return annotation.fontSize ?? stickerToolSettings.textSize;
        }
        return stickerToolSettings.textSize;
    });
    const selectedExistingTextColor = createMemo(() => {
        const annotation = selectedExistingTextAnnotation();
        if (annotation?.type === "text") {
            return annotation.style.color;
        }
        return stickerToolSettings.textColor;
    });
    const selectedExistingSerialFontFamily = createMemo(() => {
        const annotation = selectedExistingTextAnnotation();
        if (annotation?.type === "serial") {
            return annotation.fontFamily || stickerToolSettings.serialFontFamily;
        }
        return stickerToolSettings.serialFontFamily;
    });
    const selectedExistingSerialRadius = createMemo(() => {
        const annotation = selectedExistingTextAnnotation();
        if (annotation?.type === "serial") {
            return Math.max(8, Math.round(annotation.style.cornerRadius ?? stickerToolSettings.serialRadius));
        }
        return stickerToolSettings.serialRadius;
    });
    const selectedExistingSerialForegroundColor = createMemo(() => {
        const annotation = selectedExistingTextAnnotation();
        if (annotation?.type === "serial") {
            return annotation.style.color;
        }
        return stickerToolSettings.serialForegroundColor;
    });
    const selectedExistingSerialFillColor = createMemo(() => {
        const annotation = selectedExistingTextAnnotation();
        if (annotation?.type === "serial") {
            return annotation.style.fill || stickerToolSettings.serialFillColor;
        }
        return stickerToolSettings.serialFillColor;
    });
    const getEditableOpacity = () => (unit()?.data.minified ? (unit()?.data.opacityMini ?? 0.9) : (unit()?.data.opacityNormal ?? 1));
    const getEditableOpacityPercent = () => Math.round(getEditableOpacity() * 100);
    const getEditableCanvasWidth = () => Math.max(32, Math.round(unit()?.w ?? 0));
    const getEditableFrameCornerRadius = () => Math.max(0, Math.round(unit()?.data.imageEditState?.cornerRadius || 0));

    const pushCurrentStickerHistory = (includeImageData = false) => {
        const currentUnit = unit();
        if (!currentUnit) return false;
        uiActions.pushStickerHistory(
            props.unitId,
            captureStickerEditSnapshot(currentUnit, includeImageData ? { includeImageData: true } : undefined),
        );
        return true;
    };

    const applyCropFlip = async (axis: "x" | "y") => {
        const currentUnit = unit();
        if (!currentUnit) return;
        if (!pushCurrentStickerHistory(true)) return;

        const current = currentUnit.data.imageEditState || { contentEraseStrokes: [] };
        const flipped = flipStickerEditDataForFrame(currentUnit.data, currentUnit, axis);
        const rasterizedAnnotationLayerSrc = currentUnit.data.rasterizedAnnotationLayerSrc
            ? await flipRasterizedAnnotationLayer({
                  rasterizedAnnotationLayerSrc: currentUnit.data.rasterizedAnnotationLayerSrc,
                  size: { w: currentUnit.w, h: currentUnit.h },
                  axis,
              })
            : undefined;

        graphStore.actions.updateUnitData(props.unitId, {
            ...flipped,
            previewSrc: undefined,
            rasterizedAnnotationLayerSrc,
            imageEditState: {
                ...(flipped.imageEditState || current),
                flippedX: axis === "x" ? !current.flippedX : current.flippedX,
                flippedY: axis === "y" ? !current.flippedY : current.flippedY,
            },
        });
        void syncService.performWorkflowSync();
    };

    const resetCrop = () => {
        const currentUnit = unit();
        if (!currentUnit) return;
        if (!pushCurrentStickerHistory()) return;

        const restored = computeRestoredCropFrame(
            { x: currentUnit.x, y: currentUnit.y, w: currentUnit.w, h: currentUnit.h },
            currentUnit.data.imageEditState,
        );
        graphStore.actions.updateUnit(props.unitId, restored);
        graphStore.actions.updateUnitData(props.unitId, {
            imageEditState: {
                ...(currentUnit.data.imageEditState || { contentEraseStrokes: [] }),
                cropRect: undefined,
            },
        });
        void syncService.performWorkflowSync();
    };

    const parseCanvasStepperValue = (
        raw: string | null,
        fallback: number,
        min: number,
        max: number,
    ) => {
        if (raw == null) return fallback;
        const trimmed = raw.trim();
        if (!trimmed) return fallback;
        const parsed = Number.parseInt(trimmed, 10);
        if (Number.isNaN(parsed)) return fallback;
        return Math.min(max, Math.max(min, parsed));
    };

    const updateStickerOpacityValue = (next: number) => {
        const currentUnit = unit();
        if (!currentUnit) return;
        if (!pushCurrentStickerHistory()) return;
        const clamped = Math.min(1, Math.max(0, next));
        currentUnit.data.minified
            ? graphStore.actions.updateUnitData(props.unitId, { opacityMini: clamped })
            : graphStore.actions.updateUnitData(props.unitId, { opacityNormal: clamped });
        void syncService.performWorkflowSync();
    };

    const scaleStickerCanvas = (factor: number) => {
        const currentUnit = unit();
        if (!currentUnit || !Number.isFinite(factor) || factor <= 0) return;
        if (!pushCurrentStickerHistory()) return;
        graphStore.actions.resizeStickerFrame(props.unitId, scaleStickerFrame({
            x: currentUnit.x,
            y: currentUnit.y,
            w: currentUnit.w,
            h: currentUnit.h,
        }, factor));
        void syncService.performWorkflowSync();
    };

    const updateStickerFrameCornerRadiusValue = (next: number) => {
        const currentUnit = unit();
        if (!currentUnit) return;
        if (!pushCurrentStickerHistory()) return;
        const current = currentUnit.data.imageEditState || { contentEraseStrokes: [] };
        const clamped = Math.min(128, Math.max(0, Math.round(next)));
        graphStore.actions.updateUnitData(props.unitId, {
            imageEditState: {
                ...current,
                cornerRadius: clamped,
            },
        });
        void syncService.performWorkflowSync();
    };

    const commitCropOpacityDraft = () => {
        const fallback = getEditableOpacityPercent();
        const nextPercent = parseCanvasStepperValue(cropOpacityDraft(), fallback, 0, 100);
        setCropOpacityDraft(null);
        if (nextPercent === fallback) return;
        updateStickerOpacityValue(nextPercent / 100);
    };

    const commitCropCanvasWidthDraft = () => {
        const currentUnit = unit();
        if (!currentUnit) {
            setCropCanvasWidthDraft(null);
            return;
        }
        const fallback = getEditableCanvasWidth();
        const nextWidth = parseCanvasStepperValue(cropCanvasWidthDraft(), fallback, 32, 8192);
        setCropCanvasWidthDraft(null);
        if (nextWidth === fallback) return;
        scaleStickerCanvas(nextWidth / Math.max(currentUnit.w, 1));
    };

    const commitCropCornerRadiusDraft = () => {
        const fallback = getEditableFrameCornerRadius();
        const nextRadius = parseCanvasStepperValue(cropCornerRadiusDraft(), fallback, 0, 128);
        setCropCornerRadiusDraft(null);
        if (nextRadius === fallback) return;
        updateStickerFrameCornerRadiusValue(nextRadius);
    };

    const toggleCropBorder = () => {
        const currentUnit = unit();
        if (!currentUnit) return;
        if (!pushCurrentStickerHistory()) return;
        const current = currentUnit.data.imageEditState || { contentEraseStrokes: [] };
        graphStore.actions.updateUnitData(props.unitId, {
            imageEditState: toggleStickerBorder(current, stickerColorState.activeColor),
        });
        void syncService.performWorkflowSync();
    };

    const applySelectedAnnotationFontFamilyChange = (annotationType: "text" | "serial", fontFamily: string) => {
        const trimmed = fontFamily.trim();
        if (!trimmed) return;

        const selectedAnnotation = selectedExistingTextAnnotation();
        const currentUnit = unit();
        const currentState = currentUnit?.data.annotationState;
        if (selectedAnnotation?.type !== annotationType || !currentState) return;
        if (!pushCurrentStickerHistory()) return;

        graphStore.actions.updateUnitData(props.unitId, {
            annotationState: updateTextAnnotationFontFamilyById(currentState, selectedAnnotation.id, trimmed),
        });
        void syncService.performWorkflowSync();
    };

    const updateSelectedTextAnnotationStyle = (updater: (annotation: StickerTextAnnotation) => StickerTextAnnotation) => {
        const selectedAnnotation = selectedExistingTextAnnotation();
        const currentUnit = unit();
        const currentState = currentUnit?.data.annotationState;
        if (!selectedAnnotation || !currentState) return;
        if (!pushCurrentStickerHistory()) return;

        graphStore.actions.updateUnitData(props.unitId, {
            annotationState: {
                ...currentState,
                elements: currentState.elements.map((annotation) =>
                    annotation.id === selectedAnnotation.id && (annotation.type === "text" || annotation.type === "serial")
                        ? updater(annotation)
                        : annotation,
                ),
            },
        });
        void syncService.performWorkflowSync();
    };

    const patchSelectedTextAnnotationFontSize = (next: number) => {
        const clamped = Math.min(96, Math.max(8, Math.round(next)));
        updateSelectedTextAnnotationStyle((annotation) =>
            annotation.type !== "text"
                ? annotation
                : {
                      ...annotation,
                      fontSize: clamped,
                  },
        );
    };

    const patchSelectedSerialAnnotationRadius = (next: number) => {
        const clamped = Math.min(96, Math.max(8, Math.round(next)));
        updateSelectedTextAnnotationStyle((annotation) =>
            annotation.type !== "serial"
                ? annotation
                : {
                      ...annotation,
                      style: {
                          ...annotation.style,
                          cornerRadius: clamped,
                      },
                  },
        );
    };

    const patchSelectedExistingColor = (role: SelectedExistingColorRole, color: string) => {
        const normalized = normalizeStickerPaletteColor(color);
        if (!normalized) return;

        switch (role) {
            case "selected-text-color":
                updateSelectedTextAnnotationStyle((annotation) =>
                    annotation.type !== "text"
                        ? annotation
                        : {
                              ...annotation,
                              style: {
                                  ...annotation.style,
                                  color: normalized,
                              },
                          },
                );
                return;
            case "selected-serial-foreground":
                updateSelectedTextAnnotationStyle((annotation) =>
                    annotation.type !== "serial"
                        ? annotation
                        : {
                              ...annotation,
                              style: {
                                  ...annotation.style,
                                  color: normalized,
                              },
                          },
                );
                return;
            case "selected-serial-fill":
                updateSelectedTextAnnotationStyle((annotation) =>
                    annotation.type !== "serial"
                        ? annotation
                        : {
                              ...annotation,
                              style: {
                                  ...annotation.style,
                                  fill: normalized,
                              },
                          },
                );
                return;
        }
    };

    const commitSelectedTextSizeDraft = () => {
        const fallback = selectedExistingTextSize();
        const nextSize = parseCanvasStepperValue(selectedTextSizeDraft(), fallback, 8, 96);
        setSelectedTextSizeDraft(null);
        if (nextSize === fallback) return;
        patchSelectedTextAnnotationFontSize(nextSize);
    };

    const commitSelectedSerialRadiusDraft = () => {
        const fallback = selectedExistingSerialRadius();
        const nextRadius = parseCanvasStepperValue(selectedSerialRadiusDraft(), fallback, 8, 96);
        setSelectedSerialRadiusDraft(null);
        if (nextRadius === fallback) return;
        patchSelectedSerialAnnotationRadius(nextRadius);
    };

    const setNumericDraft = (key: NumericToolSettingKey, value: string) => {
        setNumericDrafts((current) => ({ ...current, [key]: value }));
    };

    const clearNumericDraft = (key: NumericToolSettingKey) => {
        setNumericDrafts((current) => {
            const next = { ...current };
            delete next[key];
            return next;
        });
    };

    const getNumericValue = (key: NumericToolSettingKey, value: number) => numericDrafts()[key] ?? String(value);

    const patchNumericSetting = (key: NumericToolSettingKey, value: number) => {
        uiActions.patchStickerToolSettings({ [key]: value } as Partial<StickerToolSettings>);
    };

    const commitNumericDraft = (key: NumericToolSettingKey, currentValue: number, min: number, max: number) => {
        const raw = numericDrafts()[key];
        if (raw === undefined) return;

        clearNumericDraft(key);
        const trimmed = raw.trim();
        const parsed = Number.parseInt(trimmed, 10);
        if (!trimmed || Number.isNaN(parsed)) {
            patchNumericSetting(key, currentValue);
            return;
        }

        patchNumericSetting(key, Math.min(max, Math.max(min, parsed)));
    };

    const openColorPicker = (slot: ShapeColorSettingKey, button: HTMLButtonElement) => {
        const rect = button.getBoundingClientRect();
        setPickerInitialColor(null);
        setSelectedExistingColorRole(null);
        setActiveColorSlot(slot);
        setColorPickerAnchor({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    };

    const openSelectedExistingColorPicker = (
        role: SelectedExistingColorRole,
        color: string,
        button: HTMLButtonElement,
    ) => {
        const rect = button.getBoundingClientRect();
        setActiveColorSlot(null);
        setSelectedExistingColorRole(role);
        setPickerInitialColor(color);
        setColorPickerAnchor({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    };

    const patchShapeColor = (key: ShapeColorSettingKey, color: string) => {
        const normalized = normalizeStickerPaletteColor(color);
        if (!normalized) return;
        uiActions.patchStickerToolSettings({ [key]: normalized } as Partial<StickerToolSettings>);
    };

    const removePaletteColor = (color: string) => {
        uiActions.removeStickerPaletteColor(color);
        for (const key of PAINT_COLOR_SETTING_KEYS) {
            if (stickerToolSettings[key] === color) {
                uiActions.patchStickerToolSettings({
                    [key]: getResetColorForSlot(key),
                } as Partial<StickerToolSettings>);
            }
        }
    };

    const MiniColorField: Component<{
        title: string;
        slot: ShapeColorSettingKey;
        Icon: Component<MiniIconProps>;
    }> = (fieldProps) => {
        let buttonRef: HTMLButtonElement | undefined;
        const current = createMemo(() => stickerToolSettings[fieldProps.slot]);
        const isTransparent = createMemo(
            () => current().trim().toLowerCase() === "transparent" || current().trim().toLowerCase() === "#00000000",
        );

        return (
            <button
                ref={buttonRef}
                type="button"
                class={`${iconShellClass} relative w-6 overflow-hidden`}
                title={fieldProps.title}
                onClick={() => {
                    if (!buttonRef) return;
                    openColorPicker(fieldProps.slot, buttonRef);
                }}
            >
                <span
                    class="absolute inset-0"
                    style={{
                        background:
                            "linear-gradient(45deg, #9ca3af 25%, transparent 25%), linear-gradient(-45deg, #9ca3af 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #9ca3af 75%), linear-gradient(-45deg, transparent 75%, #9ca3af 75%)",
                        "background-size": "6px 6px",
                        "background-position": "0 0, 0 3px, 3px -3px, -3px 0px",
                    }}
                />
                <Show when={!isTransparent()}>
                    <span class="absolute inset-[2px]" style={{ background: current() }} />
                </Show>
                <span class="relative z-[1] text-white">
                    <fieldProps.Icon class="h-3.5 w-3.5" />
                </span>
            </button>
        );
    };

    const MiniDirectColorField: Component<{
        title: string;
        value: string;
        Icon: Component<MiniIconProps>;
        onOpen: (button: HTMLButtonElement) => void;
    }> = (fieldProps) => {
        let buttonRef: HTMLButtonElement | undefined;
        const isTransparent = createMemo(
            () =>
                fieldProps.value.trim().toLowerCase() === "transparent"
                || fieldProps.value.trim().toLowerCase() === "#00000000",
        );

        return (
            <button
                ref={buttonRef}
                type="button"
                class={`${iconShellClass} relative w-6 overflow-hidden`}
                title={fieldProps.title}
                onClick={() => {
                    if (!buttonRef) return;
                    fieldProps.onOpen(buttonRef);
                }}
            >
                <span
                    class="absolute inset-0"
                    style={{
                        background:
                            "linear-gradient(45deg, #9ca3af 25%, transparent 25%), linear-gradient(-45deg, #9ca3af 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #9ca3af 75%), linear-gradient(-45deg, transparent 75%, #9ca3af 75%)",
                        "background-size": "6px 6px",
                        "background-position": "0 0, 0 3px, 3px -3px, -3px 0px",
                    }}
                />
                <Show when={!isTransparent()}>
                    <span class="absolute inset-[2px]" style={{ background: fieldProps.value }} />
                </Show>
                <span class="relative z-[1] text-white">
                    <fieldProps.Icon class="h-3.5 w-3.5" />
                </span>
            </button>
        );
    };

    const MiniNumericField: Component<{
        title: string;
        settingKey: NumericToolSettingKey;
        currentValue: number;
        min: number;
        max: number;
        Icon: Component<MiniIconProps>;
        inputClass?: string;
    }> = (fieldProps) => (
        <label class={groupedShellClass} title={fieldProps.title}>
            <fieldProps.Icon class="h-3.5 w-3.5 shrink-0 text-white/70" />
            <input
                class={`${compactInputClass} ${fieldProps.inputClass ?? ""}`.trim()}
                type="text"
                inputmode="numeric"
                value={getNumericValue(fieldProps.settingKey, fieldProps.currentValue)}
                onInput={(event) => setNumericDraft(fieldProps.settingKey, event.currentTarget.value)}
                onBlur={() =>
                    commitNumericDraft(
                        fieldProps.settingKey,
                        fieldProps.currentValue,
                        fieldProps.min,
                        fieldProps.max,
                    )
                }
                onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    commitNumericDraft(
                        fieldProps.settingKey,
                        fieldProps.currentValue,
                        fieldProps.min,
                        fieldProps.max,
                    );
                    event.currentTarget.blur();
                }}
            />
        </label>
    );

    const MiniDeferredNumericField: Component<{
        title: string;
        value: string;
        Icon: Component<MiniIconProps>;
        onInput: (value: string) => void;
        onCommit: () => void;
        inputClass?: string;
    }> = (fieldProps) => (
        <label class={groupedShellClass} title={fieldProps.title}>
            <fieldProps.Icon class="h-3.5 w-3.5 shrink-0 text-white/70" />
            <input
                class={`${compactInputClass} ${fieldProps.inputClass ?? ""}`.trim()}
                type="text"
                inputmode="numeric"
                value={fieldProps.value}
                onInput={(event) => fieldProps.onInput(event.currentTarget.value)}
                onBlur={() => fieldProps.onCommit()}
                onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    fieldProps.onCommit();
                    event.currentTarget.blur();
                }}
            />
        </label>
    );

    const MiniToggleField: Component<{
        title: string;
        enabled: boolean;
        onToggle: () => void;
        Icon: Component<MiniIconProps>;
    }> = (fieldProps) => (
        <button
            type="button"
            class={`hook-mini-toggle ${iconShellClass} w-6`}
            classList={{
                "hook-mini-toggle--active": fieldProps.enabled,
                "border-white/10 bg-black/35 text-white/75 hover:border-white/25 hover:bg-white/10": !fieldProps.enabled,
            }}
            title={fieldProps.title}
            onClick={fieldProps.onToggle}
        >
            <fieldProps.Icon class="h-3.5 w-3.5" />
        </button>
    );

    const MiniActionField: Component<{
        title: string;
        onClick: () => void | Promise<void>;
        Icon: Component<MiniIconProps>;
    }> = (fieldProps) => (
        <button
            type="button"
            class={`${iconShellClass} w-6`}
            title={fieldProps.title}
            onClick={() => void fieldProps.onClick()}
        >
            <fieldProps.Icon class="h-3.5 w-3.5" />
        </button>
    );

    const MiniSwitchField: Component<{
        title: string;
        enabled: boolean;
        onToggle: () => void;
        Icon: Component<MiniIconProps>;
    }> = (fieldProps) => (
        <button
            type="button"
            class="hook-mini-switch flex h-6 w-[42px] shrink-0 items-center justify-between border px-1.5 transition-colors"
            classList={{
                "hook-mini-switch--active": fieldProps.enabled,
                "border-white/10 bg-black/35 text-white/75 hover:border-white/25 hover:bg-white/10": !fieldProps.enabled,
            }}
            title={fieldProps.title}
            onClick={fieldProps.onToggle}
        >
            <fieldProps.Icon class="h-3.5 w-3.5 shrink-0" />
            <span
                class="hook-mini-switch__thumb h-3.5 w-3.5 shrink-0 transition-all"
                classList={{
                    "translate-x-0": fieldProps.enabled,
                    "-translate-x-0.5": !fieldProps.enabled,
                }}
            />
        </button>
    );

    const MiniDashField: Component<{ title: string }> = (fieldProps) => (
        <label class={groupedShellClass} title={fieldProps.title}>
            <select
                class={`${compactSelectClass} w-[34px] text-center`}
                title="线型"
                value={stickerToolSettings.shapeStrokeDashPattern}
                onChange={(event) =>
                    uiActions.patchStickerToolSettings({
                        shapeStrokeDashPattern: event.currentTarget.value as "solid" | "dash-1" | "dash-2",
                    })
                }
            >
                <For each={dashOptions}>
                    {(option) => <option value={option.key}>{option.label}</option>}
                </For>
            </select>
        </label>
    );

    const MiniFontField: Component<{ title: string; value: string; onChange: (value: string) => void }> = (fieldProps) => (
        <label class={groupedShellClass} title={fieldProps.title}>
            <TextIcon class="h-3.5 w-3.5 shrink-0 text-white/70" />
            <select
                class={`${compactSelectClass} w-[88px]`}
                value={fieldProps.value}
                onChange={(event) => fieldProps.onChange(event.currentTarget.value)}
            >
                <For each={availableFontFamilies()}>
                    {(font) => <option value={font}>{font}</option>}
                </For>
            </select>
        </label>
    );

    return (
        <>
            <div
                class="pointer-events-auto flex h-[40px] items-center gap-1.5 overflow-hidden border-b border-white/15 px-1.5"
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <Show when={isShapeTool()}>
                    <>
                        <MiniColorField title="描边颜色" slot={shapeStrokeColorSlot()} Icon={StrokeColorIcon} />
                        <Show when={shapeFillColorSlot()}>
                            <MiniColorField title="填充颜色" slot={shapeFillColorSlot()!} Icon={FillColorIcon} />
                        </Show>
                        <MiniSwitchField
                            title="正图形开关"
                            enabled={stickerToolSettings.shapeConstrainSquare}
                            onToggle={() =>
                                uiActions.patchStickerToolSettings({
                                    shapeConstrainSquare: !stickerToolSettings.shapeConstrainSquare,
                                })
                            }
                            Icon={SquareConstraintGlyphIcon}
                        />
                        <MiniNumericField
                            title="步进"
                            settingKey="shapeSnapStep"
                            currentValue={stickerToolSettings.shapeSnapStep}
                            min={0}
                            max={50}
                            Icon={StepIcon}
                        />
                        <MiniNumericField
                            title="线宽"
                            settingKey="strokeWidth"
                            currentValue={stickerToolSettings.strokeWidth}
                            min={0}
                            max={96}
                            Icon={LineWidthIcon}
                        />
                        <MiniDashField title="线型" />
                        <Show when={supportsCornerRadius()}>
                            <MiniNumericField
                                title="圆角半径"
                                settingKey="shapeCornerRadius"
                                currentValue={stickerToolSettings.shapeCornerRadius}
                                min={0}
                                max={256}
                                Icon={RadiusIcon}
                                inputClass="w-[30px]"
                            />
                        </Show>
                        <Show when={isPolygonTool()}>
                            <MiniNumericField
                                title="边数"
                                settingKey="polygonSides"
                                currentValue={stickerToolSettings.polygonSides}
                                min={3}
                                max={12}
                                Icon={PolygonSidesIcon}
                            />
                        </Show>
                    </>
                </Show>

                <Show when={isLineTool()}>
                    <>
                        <MiniColorField title="描边颜色" slot={shapeStrokeColorSlot()} Icon={StrokeColorIcon} />
                        <MiniNumericField
                            title="线宽"
                            settingKey="strokeWidth"
                            currentValue={stickerToolSettings.strokeWidth}
                            min={0}
                            max={96}
                            Icon={LineWidthIcon}
                        />
                        <MiniDashField title="线型" />
                        <MiniToggleField
                            title="角吸附"
                            enabled={stickerToolSettings.lineAngleSnap}
                            onToggle={() =>
                                uiActions.patchStickerToolSettings({
                                    lineAngleSnap: !stickerToolSettings.lineAngleSnap,
                                })
                            }
                            Icon={AngleSnapIcon}
                        />
                        <MiniToggleField
                            title="箭头"
                            enabled={stickerToolSettings.lineArrowEnabled}
                            onToggle={() =>
                                uiActions.patchStickerToolSettings({
                                    lineArrowEnabled: !stickerToolSettings.lineArrowEnabled,
                                })
                            }
                            Icon={ArrowHeadIcon}
                        />
                    </>
                </Show>

                <Show when={isBrushTool()}>
                    <>
                        <MiniColorField title="画笔颜色" slot="brushColor" Icon={StrokeColorIcon} />
                        <MiniNumericField
                            title="线宽"
                            settingKey="strokeWidth"
                            currentValue={stickerToolSettings.strokeWidth}
                            min={1}
                            max={96}
                            Icon={LineWidthIcon}
                        />
                        <MiniToggleField
                            title="荧光开关"
                            enabled={stickerToolSettings.brushHighlighterEnabled}
                            onToggle={() =>
                                uiActions.patchStickerToolSettings({
                                    brushHighlighterEnabled: !stickerToolSettings.brushHighlighterEnabled,
                                })
                            }
                            Icon={HighlighterGlowIcon}
                        />
                    </>
                </Show>

                <Show when={isTextTool()}>
                    <>
                        <MiniColorField title="文字颜色" slot="textColor" Icon={TextIcon} />
                        <MiniNumericField
                            title="字号"
                            settingKey="textSize"
                            currentValue={stickerToolSettings.textSize}
                            min={8}
                            max={96}
                            Icon={LineWidthIcon}
                        />
                        <MiniFontField
                            title="字体"
                            value={stickerToolSettings.textFontFamily}
                            onChange={(value) => uiActions.patchStickerToolSettings({ textFontFamily: value })}
                        />
                    </>
                </Show>

                <Show when={props.tool === "selected-text"}>
                    <>
                        <MiniDirectColorField
                            title="节点文字颜色"
                            value={selectedExistingTextColor()}
                            Icon={TextIcon}
                            onOpen={(button) =>
                                openSelectedExistingColorPicker("selected-text-color", selectedExistingTextColor(), button)
                            }
                        />
                        <MiniDeferredNumericField
                            title="节点字号"
                            value={selectedTextSizeDraft() ?? String(selectedExistingTextSize())}
                            Icon={LineWidthIcon}
                            onInput={setSelectedTextSizeDraft}
                            onCommit={commitSelectedTextSizeDraft}
                        />
                        <MiniFontField
                            title="节点字体"
                            value={selectedExistingTextFontFamily()}
                            onChange={(value) => applySelectedAnnotationFontFamilyChange("text", value)}
                        />
                    </>
                </Show>

                <Show when={isSerialTool()}>
                    <>
                        <MiniColorField title="描边颜色" slot="serialForegroundColor" Icon={StrokeColorIcon} />
                        <MiniColorField title="填充颜色" slot="serialFillColor" Icon={FillColorIcon} />
                        <MiniNumericField
                            title="半径"
                            settingKey="serialRadius"
                            currentValue={stickerToolSettings.serialRadius}
                            min={8}
                            max={96}
                            Icon={RadiusIcon}
                        />
                        <MiniFontField
                            title="字体"
                            value={stickerToolSettings.serialFontFamily}
                            onChange={(value) => uiActions.patchStickerToolSettings({ serialFontFamily: value })}
                        />
                    </>
                </Show>

                <Show when={props.tool === "selected-serial"}>
                    <>
                        <MiniDirectColorField
                            title="节点描边/数字颜色"
                            value={selectedExistingSerialForegroundColor()}
                            Icon={StrokeColorIcon}
                            onOpen={(button) =>
                                openSelectedExistingColorPicker(
                                    "selected-serial-foreground",
                                    selectedExistingSerialForegroundColor(),
                                    button,
                                )
                            }
                        />
                        <MiniDirectColorField
                            title="节点填充颜色"
                            value={selectedExistingSerialFillColor()}
                            Icon={FillColorIcon}
                            onOpen={(button) =>
                                openSelectedExistingColorPicker(
                                    "selected-serial-fill",
                                    selectedExistingSerialFillColor(),
                                    button,
                                )
                            }
                        />
                        <MiniDeferredNumericField
                            title="节点半径"
                            value={selectedSerialRadiusDraft() ?? String(selectedExistingSerialRadius())}
                            Icon={RadiusIcon}
                            onInput={setSelectedSerialRadiusDraft}
                            onCommit={commitSelectedSerialRadiusDraft}
                        />
                        <MiniFontField
                            title="节点字体"
                            value={selectedExistingSerialFontFamily()}
                            onChange={(value) => applySelectedAnnotationFontFamilyChange("serial", value)}
                        />
                    </>
                </Show>

                <Show when={isEffectTool()}>
                    <>
                        <MiniNumericField
                            title="笔刷"
                            settingKey="effectBrushSize"
                            currentValue={stickerToolSettings.effectBrushSize}
                            min={4}
                            max={200}
                            Icon={BrushIcon}
                            inputClass="w-9"
                        />
                        <Show when={props.tool === "mosaic"}>
                            <MiniNumericField
                                title="强度"
                                settingKey="mosaicSize"
                                currentValue={stickerToolSettings.mosaicSize}
                                min={2}
                                max={64}
                                Icon={MosaicIcon}
                            />
                        </Show>
                        <Show when={props.tool === "blur"}>
                            <MiniNumericField
                                title="强度"
                                settingKey="blurStrength"
                                currentValue={stickerToolSettings.blurStrength}
                                min={2}
                                max={64}
                                Icon={BlurIcon}
                            />
                        </Show>
                    </>
                </Show>

                <Show when={isEraserTool()}>
                    <>
                        <MiniNumericField
                            title="擦除半径"
                            settingKey="contentEraserSize"
                            currentValue={stickerToolSettings.contentEraserSize}
                            min={4}
                            max={96}
                            Icon={EraserIcon}
                        />
                        <MiniToggleField
                            title="只擦标记"
                            enabled={stickerToolSettings.contentEraserOnlyAnnotations}
                            onToggle={() =>
                                uiActions.patchStickerToolSettings({
                                    contentEraserOnlyAnnotations: !stickerToolSettings.contentEraserOnlyAnnotations,
                                })
                            }
                            Icon={AnnotationsOnlyFocusedIcon}
                        />
                    </>
                </Show>

                <Show when={props.tool === "crop"}>
                    <>
                        <MiniActionField title="翻X" onClick={() => applyCropFlip("x")} Icon={FlipXIcon} />
                        <MiniActionField title="翻Y" onClick={() => applyCropFlip("y")} Icon={FlipYIcon} />
                        <MiniActionField title="重置裁剪" onClick={resetCrop} Icon={ResetCropIcon} />
                        <MiniDeferredNumericField
                            title="圆角半径"
                            value={cropCornerRadiusDraft() ?? String(getEditableFrameCornerRadius())}
                            Icon={RadiusIcon}
                            onInput={setCropCornerRadiusDraft}
                            onCommit={commitCropCornerRadiusDraft}
                            inputClass="w-[30px]"
                        />
                        <MiniToggleField
                            title="边框开关"
                            enabled={!!((unit()?.data.imageEditState?.borderWidth || 0) > 0)}
                            onToggle={toggleCropBorder}
                            Icon={StrokeColorIcon}
                        />
                        <MiniDeferredNumericField
                            title="透明度"
                            value={cropOpacityDraft() ?? String(getEditableOpacityPercent())}
                            Icon={OpacityIcon}
                            onInput={setCropOpacityDraft}
                            onCommit={commitCropOpacityDraft}
                        />
                        <MiniDeferredNumericField
                            title="大小"
                            value={cropCanvasWidthDraft() ?? String(getEditableCanvasWidth())}
                            Icon={CanvasSizeIcon}
                            onInput={setCropCanvasWidthDraft}
                            onCommit={commitCropCanvasWidthDraft}
                            inputClass="w-9"
                        />
                    </>
                </Show>
            </div>

            <Show when={colorPickerAnchor() && (activeColorSlot() || selectedExistingColorRole())}>
                <Portal>
                    <ColorPicker
                        value={
                            pickerInitialColor()
                            ?? (activeColorSlot() ? stickerToolSettings[activeColorSlot()!] : "#ef4444")
                        }
                        onChange={(color) => {
                            const role = selectedExistingColorRole();
                            if (role) {
                                patchSelectedExistingColor(role, color);
                                return;
                            }
                            const slot = activeColorSlot();
                            if (slot) {
                                patchShapeColor(slot, color);
                            }
                        }}
                        onClose={() => {
                            setActiveColorSlot(null);
                            setSelectedExistingColorRole(null);
                            setColorPickerAnchor(null);
                            setPickerInitialColor(null);
                        }}
                        anchorRect={colorPickerAnchor()!}
                        palette={stickerColorState.palette}
                        defaultPalette={DEFAULT_STICKER_PALETTE}
                        onAddToPalette={(color) => {
                            uiActions.addStickerPaletteColor(color);
                        }}
                        onRemoveFromPalette={(color) => {
                            removePaletteColor(color);
                        }}
                        onPickFromScreen={
                            selectedExistingColorRole()
                                ? undefined
                                : () => {
                                      uiActions.beginStickerScreenColorPick(stickerToolSettings.activeTool);
                                  }
                        }
                    />
                </Portal>
            </Show>
        </>
    );
};
