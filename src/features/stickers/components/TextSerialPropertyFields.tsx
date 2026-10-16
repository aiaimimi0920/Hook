import { Show, type Component } from "solid-js";
import { DrawingColorField, DrawingNumberField } from "./RectanglePropertyFields";
import type { MiniFontFieldComponent } from "./stickerTopStripPropertyBarFields";

/** 新建与已选标注共用外观；提交与撤销仍由各自控制器负责。 */
export const TextSerialPropertyFields: Component<{
    serial?: boolean;
    color: string;
    fill?: string;
    size: number;
    font: string;
    onColor: (button: HTMLButtonElement) => void;
    onFill?: (button: HTMLButtonElement) => void;
    onSize: (value: number) => void;
    onFont: (value: string) => void;
    FontField: MiniFontFieldComponent;
}> = (props) => <>
    <Show when={props.serial}>
        <DrawingColorField title="填充颜色" slot="serialFillColor" value={props.fill}
            openColorPicker={(_, button) => props.onFill?.(button)} />
    </Show>
    <DrawingColorField title={props.serial ? "描边/数字颜色" : "文字颜色"}
        slot={props.serial ? "serialForegroundColor" : "textColor"} stroke={props.serial}
        value={props.color} openColorPicker={(_, button) => props.onColor(button)} />
    <DrawingNumberField setting="strokeWidth" title={props.serial ? "半径" : "字号"}
        min={8} max={999} value={props.size} onChange={(value) => { if (value !== props.size) props.onSize(value); }}
        icon={<svg class="rectangle-number-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <Show when={props.serial} fallback={<path d="m3 19 6-14 6 14M5 14h8m5-5h4m-2 0v10m-2 0h4" />}>
                <circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="1" fill="currentColor" />
                <path d="m12 12 6-6m-4 0h4v4" />
            </Show>
        </svg>} />
    <span class="text-serial-font">
        <props.FontField title="字体" value={props.font} onChange={props.onFont} />
    </span>
</>;
