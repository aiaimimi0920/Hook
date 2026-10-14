import { Show, createMemo, createSignal, onCleanup, type Component } from "solid-js";
import { Portal } from "solid-js/web";

import { ColorPicker } from "./ColorPicker";
import { RectanglePropertyFields } from "./RectanglePropertyFields";
import { LinePropertyFields } from "./LinePropertyFields";
import { BrushPropertyFields } from "./BrushPropertyFields";
import { createSelectedLineProperties } from "./stickerSelectedLineProperties";
import { createRectanglePropertyPlacement } from "./rectanglePropertyPlacement";
import { createStickerTopStripHover } from "./stickerTopStripHover";
import "../styles/rectangle-properties.css";
import { TextToolIcon } from "./stickerTopStripIcons";
import { createStickerTopStripPropertyBarFields } from "./stickerTopStripPropertyBarFields";
import {
    createStickerTopStripPropertyBarSections,
    type SelectedExistingColorRole,
} from "./stickerTopStripPropertyBarSections";
import { createPropertyBarCropController } from "./stickerTopStripPropertyBarCropController";
import { createPropertyBarSelectionController } from "./stickerTopStripPropertyBarSelectionController";
import {
    createPropertyDropdownController,
    type PropertyBarAnchorRect,
} from "./stickerTopStripPropertyDropdownController";
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
import {
    DEFAULT_STICKER_PALETTE,
    normalizeStickerPaletteColor,
} from "../services/stickerEditing";
import { captureStickerEditSnapshot } from "../services/stickerHistory";
import { mergeStickerFontFamilies } from "../services/fontCatalog";
import { api } from "../services/api";
import {
    installedStickerFonts,
    stickerColorState,
    stickerToolSettings,
    uiActions,
} from "../store/uiStore";
import type { StickerToolSettings } from "../types/stickerEditing";

interface StickerTopStripPropertyBarProps {
    unitId: string;
    tool: StickerTopStripPropertyTool;
    anchorFrame?: { left: number; top: number; width: number; height: number };
}

const iconShellClass =
    "otter-compact-control flex h-6 shrink-0 items-center justify-center transition-colors";
const groupedShellClass =
    "otter-compact-control flex h-6 shrink-0 items-center gap-0.5 px-0.5";
const compactInputClass =
    "otter-compact-input h-4 w-[28px] text-center text-[10px] outline-none";

const dashOptions: Array<{ key: "solid" | "dash-1" | "dash-2"; label: string; title: string }> = [
    { key: "solid", label: "━", title: "实线" },
    { key: "dash-1", label: "╌", title: "虚线1" },
    { key: "dash-2", label: "┄", title: "虚线2" },
];

export const StickerTopStripPropertyBar: Component<StickerTopStripPropertyBarProps> = (props) => {
    let propertyRef: HTMLDivElement | undefined;
    const hover = createStickerTopStripHover();
    onCleanup(hover.clear);
    const [numericDrafts, setNumericDrafts] = createSignal<Partial<Record<NumericToolSettingKey, string>>>({});
    const [activeColorSlot, setActiveColorSlot] = createSignal<ShapeColorSettingKey | null>(null);
    const [selectedExistingColorRole, setSelectedExistingColorRole] = createSignal<SelectedExistingColorRole | null>(null);
    const [colorPickerAnchor, setColorPickerAnchor] = createSignal<PropertyBarAnchorRect | null>(null);
    const [pickerInitialColor, setPickerInitialColor] = createSignal<string | null>(null);

    const isShapeTool = createMemo(
        () =>
            props.tool === "shape-rect" ||
            props.tool === "shape-round-rect" ||
            props.tool === "shape-ellipse" ||
            props.tool === "shape-triangle" ||
            props.tool === "shape-polygon",
    );
    const isSelectedLine = () => props.tool === "selected-line" || props.tool === "selected-bezier";
    const selectedLine = createSelectedLineProperties(() => props.unitId, isSelectedLine);
    const isLineTool = createMemo(() => props.tool === "line" || props.tool === "arrow" || props.tool === "bezier" || isSelectedLine());
    const isFreehandTool = () => props.tool === "brush" || props.tool === "paintbrush";
    const isCompactDrawingTool = () => isShapeTool() || isLineTool() || isFreehandTool()
        || ["text", "serial", "selected-text", "selected-serial", "mosaic", "blur", "content-eraser"].includes(props.tool);
    createRectanglePropertyPlacement({ panel: () => propertyRef, enabled: isCompactDrawingTool,
        frame: () => [props.anchorFrame, props.tool], unitId: () => props.unitId });
    const isBrushTool = createMemo(() => props.tool === "highlighter");
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
    const unit = createMemo(() => graphStore.units.find((item) => item.id === props.unitId));
    const pushCurrentStickerHistory = (includeImageData = false) => {
        const currentUnit = unit();
        if (!currentUnit) return false;
        uiActions.pushStickerHistory(
            props.unitId,
            captureStickerEditSnapshot(currentUnit, includeImageData ? { includeImageData: true } : undefined),
        );
        return true;
    };

    const {
        cropOpacityDraft,
        setCropOpacityDraft,
        cropCanvasWidthDraft,
        setCropCanvasWidthDraft,
        cropCornerRadiusDraft,
        setCropCornerRadiusDraft,
        isCropBorderEnabled,
        getEditableOpacityPercent,
        getEditableCanvasWidth,
        getEditableFrameCornerRadius,
        applyCropFlip,
        resetCrop,
        commitCropOpacityDraft,
        commitCropCanvasWidthDraft,
        commitCropCornerRadiusDraft,
        toggleCropBorder,
    } = createPropertyBarCropController({
        unitId: () => props.unitId,
        unit,
        pushCurrentStickerHistory,
    });
    const {
        selectedTextSizeDraft,
        setSelectedTextSizeDraft,
        selectedSerialRadiusDraft,
        setSelectedSerialRadiusDraft,
        selectedExistingTextFontFamily,
        selectedExistingTextSize,
        selectedExistingTextColor,
        selectedExistingSerialFontFamily,
        selectedExistingSerialRadius,
        selectedExistingSerialForegroundColor,
        selectedExistingSerialFillColor,
        applySelectedAnnotationFontFamilyChange,
        patchSelectedExistingColor,
        commitSelectedTextSizeDraft,
        commitSelectedSerialRadiusDraft,
    } = createPropertyBarSelectionController({
        unitId: () => props.unitId,
        unit,
        pushCurrentStickerHistory,
    });

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
        setPickerInitialColor(isSelectedLine() ? selectedLine.values()?.lineStrokeColor ?? null : null);
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
        if (isSelectedLine()) { selectedLine.patch({ lineStrokeColor: normalized }); return; }
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

    const {
        openDropdownMenu,
        closeDropdownMenu,
        toggleDropdownMenu,
        loadInstalledFontsOnDemand,
        PropertyDropdownPortal,
    } = createPropertyDropdownController({
        unitId: () => props.unitId,
        constrainToViewport: isCompactDrawingTool,
        focusOverlayWindow: () => api.focusOverlayWindow(),
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
        fontIcon: TextToolIcon,
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
        isCropBorderEnabled,
        setSelectedTextSizeDraft,
        commitSelectedTextSizeDraft,
        setSelectedSerialRadiusDraft,
        commitSelectedSerialRadiusDraft,
        openSelectedExistingColorPicker,
        openColorPicker,
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
                ref={(element) => { propertyRef = element; }}
                class={isCompactDrawingTool() ? "otter-rectangle-properties pointer-events-auto"
                    : "otter-property-strip pointer-events-auto flex h-[40px] items-center gap-1.5 overflow-hidden border-b px-1.5"}
                onPointerOver={(event) => { if (isCompactDrawingTool()) hover.over(event); }}
                onPointerOut={hover.out}
                onPointerDown={(event) => {
                    event.stopPropagation();
                    void api.focusOverlayWindow();
                }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                    void api.focusOverlayWindow();
                }}
            >
                <Show when={isShapeTool()}>
                    <RectanglePropertyFields tool={props.tool} strokeSlot={shapeStrokeColorSlot()} fillSlot={shapeFillColorSlot()!}
                        openColorPicker={openColorPicker} DashField={MiniDashField} />
                </Show>
                <Show when={isLineTool()}>
                    <LinePropertyFields bezier={props.tool === "bezier" || props.tool === "selected-bezier"}
                        selected={isSelectedLine()} values={selectedLine.values()} onPatch={isSelectedLine() ? selectedLine.patch : undefined}
                        openColorPicker={openColorPicker} DashField={MiniDashField} />
                </Show>
                <Show when={isBrushTool()}>{renderBrushFields()}</Show>
                <Show when={isFreehandTool()}><BrushPropertyFields paintbrush={props.tool === "paintbrush"} openColorPicker={openColorPicker} /></Show>
                <Show when={isTextTool()}>{renderTextFields()}</Show>
                <Show when={props.tool === "selected-text"}>{renderSelectedTextFields()}</Show>
                <Show when={isSerialTool()}>{renderSerialFields()}</Show>
                <Show when={props.tool === "selected-serial"}>{renderSelectedSerialFields()}</Show>
                <Show when={isEffectTool()}>{renderEffectFields()}</Show>
                <Show when={isEraserTool()}>{renderEraserFields()}</Show>
                <Show when={props.tool === "crop"}>{renderCropFields()}</Show>
            </div>

            <PropertyDropdownPortal />

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
