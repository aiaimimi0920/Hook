import { Show, type Component } from "solid-js";
import { stickerToolSettings, uiActions } from "../../workspace/state/uiStore";
import { DrawingColorField, DrawingNumberField } from "./RectanglePropertyFields";
import type { MiniDashFieldComponent } from "./stickerTopStripPropertyBarFields";
import type { ShapeColorSettingKey } from "./stickerToolbarModel";
import type { LinePropertyValues } from "./stickerSelectedLineProperties";

/** Straight and cubic tools share compact stroke controls, but not angle snapping. */
export const LinePropertyFields: Component<{
    bezier?: boolean;
    selected?: boolean;
    values?: LinePropertyValues;
    onPatch?: (patch: Partial<LinePropertyValues>) => void;
    openColorPicker: (slot: ShapeColorSettingKey, button: HTMLButtonElement) => void;
    DashField: MiniDashFieldComponent;
}> = (props) => {
    const values = () => props.values ?? stickerToolSettings;
    const patch = (changes: Partial<LinePropertyValues>) => props.onPatch ? props.onPatch(changes) : uiActions.patchStickerToolSettings(changes);
    return <>
    <DrawingColorField title="描边颜色" slot="lineStrokeColor" value={values().lineStrokeColor} stroke openColorPicker={props.openColorPicker} />
    <DrawingNumberField setting="strokeWidth" title="线宽" max={999} value={values().strokeWidth} onChange={(strokeWidth) => patch({ strokeWidth })} />
    <props.DashField title="线型" value={values().shapeStrokeDashPattern} onChange={(shapeStrokeDashPattern) => patch({ shapeStrokeDashPattern })} />
    <button type="button" class="rectangle-constraint" title="箭头" aria-label="箭头"
        aria-pressed={values().lineArrowEnabled}
        onClick={() => patch({ lineArrowEnabled: !values().lineArrowEnabled })}>
        <svg class="rectangle-number-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <Show when={props.bezier} fallback={<path d="M4 20 20 4M11 4h9v9" />}>
                <path d="M3 20c0-16 18 12 18-16m-5 4 5-4 2 6" />
            </Show>
        </svg>
    </button>
    <Show when={!props.bezier && !props.selected}>
        <button type="button" class="rectangle-constraint" title="角度吸附" aria-label="角度吸附"
            aria-pressed={stickerToolSettings.lineAngleSnap}
            onClick={() => uiActions.patchStickerToolSettings({ lineAngleSnap: !stickerToolSettings.lineAngleSnap })}>
            <svg class="rectangle-number-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 4v17h18M3 21 18 6M3 14a7 7 0 0 1 7 7" />
            </svg>
        </button>
    </Show>
</>;
};
