import { Show, type Component } from "solid-js";
import { DrawingNumberField } from "./RectanglePropertyFields";
import { BlurToolIcon, MosaicToolIcon } from "./stickerTopStripIcons";

/** Effect settings share compact drawing controls while keeping their existing limits. */
export const EffectPropertyFields: Component<{ blur: boolean }> = (props) => <>
    <DrawingNumberField setting="effectBrushSize" title="笔刷大小" min={4} max={200} />
    <Show when={props.blur} fallback={
        <DrawingNumberField setting="mosaicSize" title="色块大小" min={2} max={64}
            icon={<span aria-hidden="true"><MosaicToolIcon class="rectangle-number-icon" /></span>} />
    }>
        <DrawingNumberField setting="blurStrength" title="模糊强度" min={2} max={64}
            icon={<span aria-hidden="true"><BlurToolIcon class="rectangle-number-icon" /></span>} />
    </Show>
</>;
