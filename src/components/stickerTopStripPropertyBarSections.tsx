import { Show, type Accessor } from "solid-js";
import { TextSerialPropertyFields } from "./TextSerialPropertyFields";
import { EffectPropertyFields } from "./EffectPropertyFields";
import { DrawingNumberField } from "./RectanglePropertyFields";

import {
    AngleSnapIcon,
    AnnotationsOnlyFocusedIcon,
    ArrowHeadIcon,
    CanvasSizeIcon,
    FillColorIcon,
    FlipXIcon,
    FlipYIcon,
    HighlighterGlowIcon,
    LineWidthIcon,
    OpacityIcon,
    PolygonSidesIcon,
    RadiusIcon,
    ResetCropIcon,
    SquareConstraintGlyphIcon,
    StepIcon,
    StrokeColorIcon,
} from "./stickerTopStripPropertyBarIcons";
import type {
    MiniActionFieldComponent,
    MiniColorFieldComponent,
    MiniDashFieldComponent,
    MiniDeferredNumericFieldComponent,
    MiniDirectColorFieldComponent,
    MiniFontFieldComponent,
    MiniNumericFieldComponent,
    MiniSwitchFieldComponent,
    MiniToggleFieldComponent,
} from "./stickerTopStripPropertyBarFields";
import type {
    ShapeColorSettingKey,
    StickerTopStripPropertyTool,
} from "./stickerToolbarModel";
import type { StickerToolSettings } from "../types/stickerEditing";

export type SelectedExistingColorRole =
    | "selected-text-color"
    | "selected-serial-foreground"
    | "selected-serial-fill";

interface CreateStickerTopStripPropertyBarSectionsOptions {
    openColorPicker: (slot: ShapeColorSettingKey, button: HTMLButtonElement) => void;
    tool: Accessor<StickerTopStripPropertyTool>;
    stickerToolSettings: StickerToolSettings;
    shapeStrokeColorSlot: Accessor<ShapeColorSettingKey>;
    shapeFillColorSlot: Accessor<ShapeColorSettingKey | null>;
    supportsCornerRadius: Accessor<boolean>;
    isPolygonTool: Accessor<boolean>;
    selectedExistingTextColor: Accessor<string>;
    selectedTextSizeDraft: Accessor<string | null>;
    selectedExistingTextSize: Accessor<number>;
    selectedExistingTextFontFamily: Accessor<string>;
    selectedExistingSerialForegroundColor: Accessor<string>;
    selectedExistingSerialFillColor: Accessor<string>;
    selectedSerialRadiusDraft: Accessor<string | null>;
    selectedExistingSerialRadius: Accessor<number>;
    selectedExistingSerialFontFamily: Accessor<string>;
    cropCornerRadiusDraft: Accessor<string | null>;
    cropOpacityDraft: Accessor<string | null>;
    cropCanvasWidthDraft: Accessor<string | null>;
    isCropBorderEnabled: Accessor<boolean>;
    setSelectedTextSizeDraft: (value: string | null) => void;
    commitSelectedTextSizeDraft: () => void;
    setSelectedSerialRadiusDraft: (value: string | null) => void;
    commitSelectedSerialRadiusDraft: () => void;
    openSelectedExistingColorPicker: (
        role: SelectedExistingColorRole,
        color: string,
        button: HTMLButtonElement,
    ) => void;
    applySelectedAnnotationFontFamilyChange: (annotationType: "text" | "serial", fontFamily: string) => void;
    patchStickerToolSettings: (patch: Partial<StickerToolSettings>) => void;
    applyCropFlip: (axis: "x" | "y") => void | Promise<void>;
    resetCrop: () => void;
    getEditableFrameCornerRadius: () => number;
    setCropCornerRadiusDraft: (value: string | null) => void;
    commitCropCornerRadiusDraft: () => void;
    toggleCropBorder: () => void;
    getEditableOpacityPercent: () => number;
    setCropOpacityDraft: (value: string | null) => void;
    commitCropOpacityDraft: () => void;
    getEditableCanvasWidth: () => number;
    setCropCanvasWidthDraft: (value: string | null) => void;
    commitCropCanvasWidthDraft: () => void;
    MiniActionField: MiniActionFieldComponent;
    MiniColorField: MiniColorFieldComponent;
    MiniDashField: MiniDashFieldComponent;
    MiniDeferredNumericField: MiniDeferredNumericFieldComponent;
    MiniDirectColorField: MiniDirectColorFieldComponent;
    MiniFontField: MiniFontFieldComponent;
    MiniNumericField: MiniNumericFieldComponent;
    MiniSwitchField: MiniSwitchFieldComponent;
    MiniToggleField: MiniToggleFieldComponent;
}

export const createStickerTopStripPropertyBarSections = (options: CreateStickerTopStripPropertyBarSectionsOptions) => {
    const renderShapeFields = () => (
        <>
            <options.MiniColorField title="描边颜色" slot={options.shapeStrokeColorSlot()} Icon={StrokeColorIcon} />
            <Show when={options.shapeFillColorSlot()}>
                <options.MiniColorField
                    title="填充颜色"
                    slot={options.shapeFillColorSlot()!}
                    Icon={FillColorIcon}
                />
            </Show>
            <options.MiniSwitchField
                title="正图形开关"
                enabled={options.stickerToolSettings.shapeConstrainSquare}
                onToggle={() =>
                    options.patchStickerToolSettings({
                        shapeConstrainSquare: !options.stickerToolSettings.shapeConstrainSquare,
                    })
                }
                Icon={SquareConstraintGlyphIcon}
            />
            <options.MiniNumericField
                title="步进"
                settingKey="shapeSnapStep"
                currentValue={options.stickerToolSettings.shapeSnapStep}
                min={0}
                max={50}
                Icon={StepIcon}
            />
            <options.MiniNumericField
                title="线宽"
                settingKey="strokeWidth"
                currentValue={options.stickerToolSettings.strokeWidth}
                min={0}
                max={96}
                Icon={LineWidthIcon}
            />
            <options.MiniDashField title="线型" />
            <Show when={options.supportsCornerRadius()}>
                <options.MiniNumericField
                    title="圆角半径"
                    settingKey="shapeCornerRadius"
                    currentValue={options.stickerToolSettings.shapeCornerRadius}
                    min={0}
                    max={256}
                    Icon={RadiusIcon}
                    inputClass="w-[30px]"
                />
            </Show>
            <Show when={options.isPolygonTool()}>
                <options.MiniNumericField
                    title="边数"
                    settingKey="polygonSides"
                    currentValue={options.stickerToolSettings.polygonSides}
                    min={3}
                    max={12}
                    Icon={PolygonSidesIcon}
                />
            </Show>
        </>
    );

    const renderLineFields = () => (
        <>
            <options.MiniColorField title="描边颜色" slot={options.shapeStrokeColorSlot()} Icon={StrokeColorIcon} />
            <options.MiniNumericField
                title="线宽"
                settingKey="strokeWidth"
                currentValue={options.stickerToolSettings.strokeWidth}
                min={0}
                max={96}
                Icon={LineWidthIcon}
            />
            <options.MiniDashField title="线型" />
            <options.MiniToggleField
                title="角吸附"
                enabled={options.stickerToolSettings.lineAngleSnap}
                onToggle={() =>
                    options.patchStickerToolSettings({
                        lineAngleSnap: !options.stickerToolSettings.lineAngleSnap,
                    })
                }
                Icon={AngleSnapIcon}
            />
            <options.MiniToggleField
                title="箭头"
                enabled={options.stickerToolSettings.lineArrowEnabled}
                onToggle={() =>
                    options.patchStickerToolSettings({
                        lineArrowEnabled: !options.stickerToolSettings.lineArrowEnabled,
                    })
                }
                Icon={ArrowHeadIcon}
            />
        </>
    );

    const renderBrushFields = () => (
        <>
            <options.MiniColorField title="画笔颜色" slot="brushColor" Icon={StrokeColorIcon} />
            <options.MiniNumericField
                title="线宽"
                settingKey="strokeWidth"
                currentValue={options.stickerToolSettings.strokeWidth}
                min={1}
                max={96}
                Icon={LineWidthIcon}
            />
            <options.MiniToggleField
                title="荧光开关"
                enabled={options.stickerToolSettings.brushHighlighterEnabled}
                onToggle={() =>
                    options.patchStickerToolSettings({
                        brushHighlighterEnabled: !options.stickerToolSettings.brushHighlighterEnabled,
                    })
                }
                Icon={HighlighterGlowIcon}
            />
        </>
    );

    const renderTextFields = () => (
        <TextSerialPropertyFields color={options.stickerToolSettings.textColor}
            size={options.stickerToolSettings.textSize} font={options.stickerToolSettings.textFontFamily}
            onColor={(button) => options.openColorPicker("textColor", button)}
            onSize={(textSize) => options.patchStickerToolSettings({ textSize })}
            onFont={(textFontFamily) => options.patchStickerToolSettings({ textFontFamily })} FontField={options.MiniFontField} />
    );

    const renderSelectedTextFields = () => (
        <TextSerialPropertyFields color={options.selectedExistingTextColor()}
            size={options.selectedExistingTextSize()} font={options.selectedExistingTextFontFamily()}
            onColor={(button) => options.openSelectedExistingColorPicker("selected-text-color", options.selectedExistingTextColor(), button)}
            onSize={(value) => { options.setSelectedTextSizeDraft(String(value)); options.commitSelectedTextSizeDraft(); }}
            onFont={(value) => options.applySelectedAnnotationFontFamilyChange("text", value)} FontField={options.MiniFontField} />
    );

    const renderSerialFields = () => (
        <TextSerialPropertyFields serial color={options.stickerToolSettings.serialForegroundColor}
            fill={options.stickerToolSettings.serialFillColor}
            size={options.stickerToolSettings.serialRadius} font={options.stickerToolSettings.serialFontFamily}
            onColor={(button) => options.openColorPicker("serialForegroundColor", button)}
            onFill={(button) => options.openColorPicker("serialFillColor", button)}
            onSize={(serialRadius) => options.patchStickerToolSettings({ serialRadius })}
            onFont={(serialFontFamily) => options.patchStickerToolSettings({ serialFontFamily })} FontField={options.MiniFontField} />
    );

    const renderSelectedSerialFields = () => (
        <TextSerialPropertyFields serial color={options.selectedExistingSerialForegroundColor()}
            fill={options.selectedExistingSerialFillColor()}
            size={options.selectedExistingSerialRadius()} font={options.selectedExistingSerialFontFamily()}
            onColor={(button) => options.openSelectedExistingColorPicker("selected-serial-foreground", options.selectedExistingSerialForegroundColor(), button)}
            onFill={(button) => options.openSelectedExistingColorPicker("selected-serial-fill", options.selectedExistingSerialFillColor(), button)}
            onSize={(value) => { options.setSelectedSerialRadiusDraft(String(value)); options.commitSelectedSerialRadiusDraft(); }}
            onFont={(value) => options.applySelectedAnnotationFontFamilyChange("serial", value)} FontField={options.MiniFontField} />
    );

    const renderEffectFields = () => <EffectPropertyFields blur={options.tool() === "blur"} />;

    const renderEraserFields = () => (
        <>
            <DrawingNumberField title="擦除大小" setting="contentEraserSize" min={4} max={96} />
            <button type="button" class="rectangle-constraint" title="只擦标记" aria-label="只擦标记"
                aria-pressed={options.stickerToolSettings.contentEraserOnlyAnnotations}
                onClick={() =>
                    options.patchStickerToolSettings({
                        contentEraserOnlyAnnotations: !options.stickerToolSettings.contentEraserOnlyAnnotations,
                    })
                }
            >
                <span aria-hidden="true"><AnnotationsOnlyFocusedIcon class="rectangle-number-icon" /></span>
            </button>
        </>
    );

    const renderCropFields = () => (
        <>
            <options.MiniActionField title="翻X" onClick={() => options.applyCropFlip("x")} Icon={FlipXIcon} />
            <options.MiniActionField title="翻Y" onClick={() => options.applyCropFlip("y")} Icon={FlipYIcon} />
            <options.MiniActionField title="重置裁剪" onClick={options.resetCrop} Icon={ResetCropIcon} />
            <options.MiniDeferredNumericField
                title="圆角半径"
                value={options.cropCornerRadiusDraft() ?? String(options.getEditableFrameCornerRadius())}
                Icon={RadiusIcon}
                onInput={options.setCropCornerRadiusDraft}
                onCommit={options.commitCropCornerRadiusDraft}
                inputClass="w-[30px]"
            />
            <options.MiniToggleField
                title="边框开关"
                enabled={options.isCropBorderEnabled()}
                onToggle={options.toggleCropBorder}
                Icon={StrokeColorIcon}
            />
            <options.MiniDeferredNumericField
                title="透明度"
                value={options.cropOpacityDraft() ?? String(options.getEditableOpacityPercent())}
                Icon={OpacityIcon}
                onInput={options.setCropOpacityDraft}
                onCommit={options.commitCropOpacityDraft}
            />
            <options.MiniDeferredNumericField
                title="大小"
                value={options.cropCanvasWidthDraft() ?? String(options.getEditableCanvasWidth())}
                Icon={CanvasSizeIcon}
                onInput={options.setCropCanvasWidthDraft}
                onCommit={options.commitCropCanvasWidthDraft}
                inputClass="w-9"
            />
        </>
    );

    return {
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
    };
};
