import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Component } from "solid-js";
import { Portal } from "solid-js/web";

import { ColorPicker } from "./ColorPicker";
import {
    TextIcon,
} from "./stickerTopStripPropertyBarIcons";
import {
    createStickerTopStripPropertyBarFields,
    type MiniDropdownOption,
} from "./stickerTopStripPropertyBarFields";
import {
    createStickerTopStripPropertyBarSections,
    type SelectedExistingColorRole,
} from "./stickerTopStripPropertyBarSections";
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
import { api } from "../services/api";
import { syncService } from "../services/syncService";
import { addOrUpdateRect, removeRect } from "../services/uiRegistry";
import {
    installedStickerFonts,
    selectedStickerAnnotationId,
    selectedStickerAnnotationIds,
    setInstalledStickerFonts,
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

interface OpenMiniDropdownMenu {
    id: string;
    anchor: AnchorRect;
    width: number;
    options: MiniDropdownOption[];
    value: string;
    onSelect: (value: string) => void;
}

const iconShellClass =
    "flex h-6 shrink-0 items-center justify-center border border-white/10 bg-black/35 text-white/80 transition-colors hover:border-white/25 hover:bg-white/10";
const groupedShellClass =
    "flex h-6 shrink-0 items-center gap-0.5 border border-white/10 bg-black/35 px-0.5 text-white/85";
const compactInputClass =
    "h-4 w-[28px] bg-transparent text-center text-[10px] text-white outline-none placeholder:text-white/30";

const dashOptions: Array<{ key: "solid" | "dash-1" | "dash-2"; label: string; title: string }> = [
    { key: "solid", label: "━", title: "实线" },
    { key: "dash-1", label: "╌", title: "虚线1" },
    { key: "dash-2", label: "┄", title: "虚线2" },
];

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
    const [openDropdownMenu, setOpenDropdownMenu] = createSignal<OpenMiniDropdownMenu | null>(null);
    const dropdownRectId = () => `sticker-top-strip-property-dropdown-${props.unitId}`;
    let openDropdownMenuRef: HTMLDivElement | undefined;
    let dropdownRectSyncRafIds: number[] = [];

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
    const [isLoadingInstalledFonts, setIsLoadingInstalledFonts] = createSignal(false);
    const [hasLoadedInstalledFonts, setHasLoadedInstalledFonts] = createSignal(false);
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
        if (currentUnit.data.minified) {
            graphStore.actions.updateUnitData(props.unitId, { opacityMini: clamped });
        } else {
            graphStore.actions.updateUnitData(props.unitId, { opacityNormal: clamped });
        }
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
        closeDropdownMenu();
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
        closeDropdownMenu();
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

    const closeDropdownMenu = () => {
        setOpenDropdownMenu(null);
    };

    const loadInstalledFontsOnDemand = () => {
        if (hasLoadedInstalledFonts() || isLoadingInstalledFonts()) {
            return;
        }

        setIsLoadingInstalledFonts(true);
        void api.getInstalledFonts()
            .then((fonts) => {
                setInstalledStickerFonts(fonts);
                setHasLoadedInstalledFonts(true);
            })
            .catch((error) => {
                console.warn("Failed to load installed fonts:", error);
            })
            .finally(() => {
                setIsLoadingInstalledFonts(false);
            });
    };

    const toggleDropdownMenu = (
        id: string,
        anchor: AnchorRect,
        width: number,
        options: MiniDropdownOption[],
        value: string,
        onSelect: (value: string) => void,
    ) => {
        setOpenDropdownMenu((current) => {
            if (current?.id === id) {
                return null;
            }
            return {
                id,
                anchor,
                width,
                options,
                value,
                onSelect,
            };
        });
    };

    const syncOpenDropdownRect = (
        menu: OpenMiniDropdownMenu | null,
        rectId: string,
        dropdownElement: HTMLDivElement | undefined,
    ) => {
        if (!menu || !dropdownElement) return false;
        const bounds = dropdownElement.getBoundingClientRect();
        addOrUpdateRect({
            id: rectId,
            x: bounds.left,
            y: bounds.top,
            width: bounds.width,
            height: bounds.height,
            name: "STICKER_TOP_STRIP_MENU",
        });
        void syncService.updateBackendRects();
        return true;
    };

    const cancelDropdownRectSync = () => {
        for (const rafId of dropdownRectSyncRafIds) {
            window.cancelAnimationFrame(rafId);
        }
        dropdownRectSyncRafIds = [];
    };

    const scheduleDropdownRectSync = (menu: OpenMiniDropdownMenu | null) => {
        if (typeof window === "undefined") return;
        cancelDropdownRectSync();
        const rectId = dropdownRectId();
        const dropdownElement = openDropdownMenuRef;

        const scheduleFrame = (remainingFrames: number) => {
            const rafId = window.requestAnimationFrame(() => {
                dropdownRectSyncRafIds = dropdownRectSyncRafIds.filter((item) => item !== rafId);
                if (!syncOpenDropdownRect(menu, rectId, dropdownElement) && remainingFrames > 0) {
                    scheduleFrame(remainingFrames - 1);
                }
            });
            dropdownRectSyncRafIds.push(rafId);
        };

        scheduleFrame(3);
    };

    createEffect(() => {
        const menu = openDropdownMenu();
        if (typeof window === "undefined" || !menu) return;

        scheduleDropdownRectSync(menu);
        const handleResize = () => scheduleDropdownRectSync(menu);
        window.addEventListener("resize", handleResize);

        onCleanup(() => {
            cancelDropdownRectSync();
            window.removeEventListener("resize", handleResize);
            removeRect(dropdownRectId());
            void syncService.updateBackendRects();
        });
    });

    createEffect(() => {
        const menu = openDropdownMenu();
        if (typeof window === "undefined" || !menu) return;

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Node && openDropdownMenuRef?.contains(target)) {
                return;
            }
            if (target instanceof Element) {
                const trigger = target.closest(`[data-top-strip-popup-trigger="${menu.id}"]`);
                if (trigger) {
                    return;
                }
            }
            closeDropdownMenu();
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                closeDropdownMenu();
            }
        };

        window.addEventListener("pointerdown", handlePointerDown, true);
        window.addEventListener("keydown", handleKeyDown, true);

        onCleanup(() => {
            window.removeEventListener("pointerdown", handlePointerDown, true);
            window.removeEventListener("keydown", handleKeyDown, true);
        });
    });

    const {
        MiniActionField,
        MiniColorField,
        MiniDashField,
        MiniDeferredNumericField,
        MiniDirectColorField,
        MiniFontField,
        MiniNumericField,
        MiniSwitchField,
        MiniToggleField,
    } = createStickerTopStripPropertyBarFields({
        unitId: () => props.unitId,
        dashOptions,
        iconShellClass,
        groupedShellClass,
        compactInputClass,
        stickerToolSettings,
        availableFontFamilies,
        fontIcon: TextIcon,
        focusOverlayWindow: () => api.focusOverlayWindow(),
        openColorPicker,
        getNumericValue,
        setNumericDraft,
        commitNumericDraft,
        isDropdownOpen: (id) => openDropdownMenu()?.id === id,
        patchStickerToolSettings: (patch) => uiActions.patchStickerToolSettings(patch),
        toggleDropdownMenu,
        closeDropdownMenu,
        loadInstalledFontsOnDemand,
    });
    const {
        renderShapeFields,
        renderLineFields,
        renderBrushFields,
        renderTextFields,
        renderSelectedTextFields,
        renderSerialFields,
        renderSelectedSerialFields,
        renderEffectFields,
        renderEraserFields,
        renderCropFields,
    } = createStickerTopStripPropertyBarSections({
        tool: () => props.tool,
        stickerToolSettings,
        shapeStrokeColorSlot,
        shapeFillColorSlot,
        supportsCornerRadius,
        isPolygonTool,
        selectedExistingTextColor,
        selectedTextSizeDraft,
        selectedExistingTextSize,
        selectedExistingTextFontFamily,
        selectedExistingSerialForegroundColor,
        selectedExistingSerialFillColor,
        selectedSerialRadiusDraft,
        selectedExistingSerialRadius,
        selectedExistingSerialFontFamily,
        cropCornerRadiusDraft,
        cropOpacityDraft,
        cropCanvasWidthDraft,
        isCropBorderEnabled: () => !!((unit()?.data.imageEditState?.borderWidth || 0) > 0),
        setSelectedTextSizeDraft,
        commitSelectedTextSizeDraft,
        setSelectedSerialRadiusDraft,
        commitSelectedSerialRadiusDraft,
        openSelectedExistingColorPicker,
        applySelectedAnnotationFontFamilyChange,
        patchStickerToolSettings: (patch) => uiActions.patchStickerToolSettings(patch),
        applyCropFlip,
        resetCrop,
        getEditableFrameCornerRadius,
        setCropCornerRadiusDraft,
        commitCropCornerRadiusDraft,
        toggleCropBorder,
        getEditableOpacityPercent,
        setCropOpacityDraft,
        commitCropOpacityDraft,
        getEditableCanvasWidth,
        setCropCanvasWidthDraft,
        commitCropCanvasWidthDraft,
        MiniActionField,
        MiniColorField,
        MiniDashField,
        MiniDeferredNumericField,
        MiniDirectColorField,
        MiniFontField,
        MiniNumericField,
        MiniSwitchField,
        MiniToggleField,
    });

    return (
        <>
            <div
                class="pointer-events-auto flex h-[40px] items-center gap-1.5 overflow-hidden border-b border-white/15 px-1.5"
                onPointerDown={(event) => {
                    event.stopPropagation();
                    void api.focusOverlayWindow();
                }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                    void api.focusOverlayWindow();
                }}
            >
                <Show when={isShapeTool()}>{renderShapeFields()}</Show>
                <Show when={isLineTool()}>{renderLineFields()}</Show>
                <Show when={isBrushTool()}>{renderBrushFields()}</Show>
                <Show when={isTextTool()}>{renderTextFields()}</Show>
                <Show when={props.tool === "selected-text"}>{renderSelectedTextFields()}</Show>
                <Show when={isSerialTool()}>{renderSerialFields()}</Show>
                <Show when={props.tool === "selected-serial"}>{renderSelectedSerialFields()}</Show>
                <Show when={isEffectTool()}>{renderEffectFields()}</Show>
                <Show when={isEraserTool()}>{renderEraserFields()}</Show>
                <Show when={props.tool === "crop"}>{renderCropFields()}</Show>
            </div>

            <Show when={openDropdownMenu()}>
                {(menu) => (
                    <Portal>
                        <div
                            ref={(element) => {
                                openDropdownMenuRef = element;
                                syncOpenDropdownRect(menu(), dropdownRectId(), element);
                            }}
                            data-top-strip-menu="true"
                            data-top-strip-property-popup="true"
                            class="pointer-events-auto fixed z-[1305] overflow-hidden border border-white/15 bg-[rgba(7,10,7,0.96)] shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
                            style={{
                                left: `${menu().anchor.x}px`,
                                top: `${menu().anchor.y + menu().anchor.height + 4}px`,
                                width: `${menu().width}px`,
                            }}
                            onPointerDown={(event) => {
                                event.stopPropagation();
                                void api.focusOverlayWindow();
                            }}
                            onMouseDown={(event) => {
                                event.stopPropagation();
                                void api.focusOverlayWindow();
                            }}
                            onPointerMove={(event) => event.stopPropagation()}
                            onWheel={(event) => event.stopPropagation()}
                        >
                            <div class="max-h-[220px] overflow-y-auto overflow-x-hidden py-1">
                                <For each={menu().options}>
                                    {(option) => (
                                        <button
                                            type="button"
                                            class="flex h-7 w-full items-center px-2 text-left text-[11px] text-white transition-colors hover:bg-white/10"
                                            classList={{
                                                "bg-white/12 text-[#d9ff38]": menu().value === option.value,
                                            }}
                                            title={option.title ?? option.label}
                                            onClick={() => {
                                                menu().onSelect(option.value);
                                            }}
                                        >
                                            <span class="truncate">{option.label}</span>
                                        </button>
                                    )}
                                </For>
                            </div>
                        </div>
                    </Portal>
                )}
            </Show>

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
