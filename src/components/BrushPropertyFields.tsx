import { Show, type Component } from "solid-js";
import { stickerToolSettings, uiActions } from "../store/uiStore";
import { freehandOpacity, freehandSmoothing } from "../services/stickerPaintbrushGeometry";
import { DrawingColorField, DrawingNumberField } from "./RectanglePropertyFields";
import type { ShapeColorSettingKey } from "./stickerToolbarModel";

/** Compact freehand controls share the established drawing-toolbar dimensions. */
export const BrushPropertyFields: Component<{
    paintbrush: boolean;
    openColorPicker: (slot: ShapeColorSettingKey, button: HTMLButtonElement) => void;
}> = (props) => <>
    <DrawingColorField title="笔触颜色" slot="brushColor" openColorPicker={props.openColorPicker} />
    <DrawingNumberField setting="strokeWidth" title="粗细" min={1} max={999} />
        <DrawingNumberField setting="strokeWidth" title="不透明度" max={100}
            value={Math.round(freehandOpacity(stickerToolSettings.brushOpacity) * 100)}
            onChange={(value) => uiActions.patchStickerToolSettings({ brushOpacity: value / 100 })}
            icon={<svg class="rectangle-number-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
            </svg>} />
    <DrawingNumberField setting="strokeWidth" title="平滑度" max={100} value={freehandSmoothing(stickerToolSettings.brushSmoothing)}
        onChange={(brushSmoothing) => uiActions.patchStickerToolSettings({ brushSmoothing })}
        icon={<svg class="rectangle-number-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <path d="M3 17c3-18 15 18 18-10" />
        </svg>} />
    <Show when={!props.paintbrush}>
        <button type="button" class="rectangle-constraint" title="荧光开关" aria-label="荧光开关" aria-pressed={stickerToolSettings.brushHighlighterEnabled}
            onClick={() => uiActions.patchStickerToolSettings({ brushHighlighterEnabled: !stickerToolSettings.brushHighlighterEnabled })}>
            <svg class="rectangle-number-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">
                <path d="m8 14 7-11 6 4-7 11Zm0 0-3 5 7-2M3 22h15" />
            </svg>
        </button>
    </Show>
</>;
