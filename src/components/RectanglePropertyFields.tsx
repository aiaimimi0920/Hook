import { Show, createSignal, type Component, type JSX } from "solid-js";
import { stickerToolSettings, uiActions } from "../store/uiStore";
import type { ShapeColorSettingKey, StickerTopStripPropertyTool } from "./stickerToolbarModel";
import type { MiniDashFieldComponent } from "./stickerTopStripPropertyBarFields";
import { RectangleAspectRatioField } from "./RectangleAspectRatioField";
import { hexToRgb } from "./ColorPicker/colorMath";

type NumberKey = "strokeWidth" | "shapeCornerRadius" | "shapeSnapStep" | "polygonSides"
    | "effectBrushSize" | "mosaicSize" | "blurStrength" | "contentEraserSize";
export const DrawingNumberField: Component<{ setting: NumberKey; title: string; max: number; min?: number; value?: number; icon?: JSX.Element; onChange?: (value: number) => void }> = (props) => {
    const [draft, setDraft] = createSignal<string>();
    const current = () => props.value ?? stickerToolSettings[props.setting];
    const update = (value: number) => {
        const clamped = Math.max(props.min ?? 0, Math.min(props.max, Math.round(value)));
        if (props.onChange) props.onChange(clamped);
        else uiActions.patchStickerToolSettings({ [props.setting]: clamped });
    };
    const commit = () => {
        const raw = draft();
        setDraft(undefined);
        if (raw === undefined || !raw.trim()) return;
        const value = Number(raw);
        if (Number.isFinite(value)) update(value);
    };
    const step = (direction: number) => {
        commit();
        update(current() + direction);
    };
    return <div class="rectangle-number rectangle-number-with-icon" title={props.title}>
        {props.icon}
        <Show when={["strokeWidth", "effectBrushSize", "contentEraserSize"].includes(props.setting) && !props.icon}>
            <svg class="rectangle-number-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true">
                <path d="M4 5h16" stroke-width="1" />
                <path d="M4 11.5h16" stroke-width="2.5" />
                <path d="M4 19h16" stroke-width="4" />
            </svg>
        </Show>
        <Show when={props.setting === "shapeCornerRadius"}>
            <svg class="rectangle-number-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4 20V12a8 8 0 0 1 8-8h8" />
            </svg>
        </Show>
        <Show when={props.setting === "shapeSnapStep"}>
            <svg class="rectangle-number-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M6 9c-2.5 0-4 2.7-3.5 5.5l1 5c.3 1.6 1.5 2.5 3 2.2 1.6-.3 2.3-1.5 1.8-3.1l-.5-1.5c-.4-1.3.1-2.2 1-3.3C10.5 11.8 8.5 9 6 9Z" transform="rotate(-12 6 15.5)" />
                <path d="M17 2c2.5 0 4 2.7 3.5 5.5l-1 5c-.3 1.6-1.5 2.5-3 2.2-1.6-.3-2.3-1.5-1.8-3.1l.5-1.5c.4-1.3-.1-2.2-1-3.3C12.5 4.8 14.5 2 17 2Z" transform="rotate(12 17 8.5)" />
            </svg>
        </Show>
        <Show when={props.setting === "polygonSides"}>
            <svg class="rectangle-number-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
                <path d="m12 2 9 6v9l-9 5-9-5V8Z" />
            </svg>
        </Show>
        <input aria-label={props.title} type="text" inputmode="numeric" maxlength={3} value={draft() ?? current()}
            onInput={(event) => {
                const next = event.currentTarget.value;
                if (/^\d{0,3}$/.test(next)) setDraft(next);
                else event.currentTarget.value = draft() ?? String(current());
            }} onBlur={commit}
            onKeyDown={(event) => {
                if (event.key === "Enter") { commit(); event.currentTarget.blur(); }
                if (event.key === "Escape") { setDraft(undefined); event.currentTarget.blur(); }
                if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                    event.preventDefault(); step(event.key === "ArrowUp" ? 1 : -1);
                }
            }} />
        <span class="rectangle-steppers">
            <button type="button" aria-label={`增加${props.title}`} onClick={() => step(1)}>
                <svg viewBox="0 0 12 8" aria-hidden="true"><path d="m1 7 5-6 5 6Z" /></svg>
            </button>
            <button type="button" aria-label={`减少${props.title}`} onClick={() => step(-1)}>
                <svg viewBox="0 0 12 8" aria-hidden="true"><path d="m1 1 5 6 5-6Z" /></svg>
            </button>
        </span>
    </div>;
};

export const DrawingColorField: Component<{
    slot: ShapeColorSettingKey;
    title: string;
    stroke?: boolean;
    value?: string;
    openColorPicker: (slot: ShapeColorSettingKey, button: HTMLButtonElement) => void;
}> = (field) => {
        const color = () => field.value ?? stickerToolSettings[field.slot];
        return <button type="button" class="rectangle-color" title={field.title} aria-label={field.title}
            onClick={(event) => field.openColorPicker(field.slot, event.currentTarget)}>
            <span class="rectangle-swatch" classList={{ "rectangle-stroke-swatch": field.stroke }} aria-hidden="true">
                <span class="rectangle-swatch-color" style={field.stroke
                    ? { border: `3px solid ${color()}` } : { background: color() }} />
                <Show when={hexToRgb(color()).a === 0}>
                    <svg class="rectangle-transparent-mark" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                        <path d="M1 19 19 1" stroke="var(--theme-danger, #f43f5e)" stroke-width="1.8" stroke-linecap="round" />
                    </svg>
                </Show>
            </span>
        </button>;
};

/** 图形共用外观控件；只展示当前图形支持的设置，不改变其几何约束语义。 */
export const RectanglePropertyFields: Component<{
    tool: StickerTopStripPropertyTool;
    strokeSlot: ShapeColorSettingKey;
    fillSlot: ShapeColorSettingKey;
    openColorPicker: (slot: ShapeColorSettingKey, button: HTMLButtonElement) => void;
    DashField: MiniDashFieldComponent;
}> = (props) => {
    const supportsAspectRatio = () => props.tool === "shape-rect" || props.tool === "shape-round-rect" || props.tool === "shape-ellipse";
    return <>
        <DrawingColorField title="填充颜色" slot={props.fillSlot} openColorPicker={props.openColorPicker} />
        <DrawingColorField title="描边颜色" slot={props.strokeSlot} stroke openColorPicker={props.openColorPicker} />
        <DrawingNumberField setting="strokeWidth" title="线宽" max={999} />
        <Show when={props.tool !== "shape-ellipse"}>
            <DrawingNumberField setting="shapeCornerRadius" title="圆角半径" max={999} />
        </Show>
        <props.DashField title="线型" />
        <Show when={supportsAspectRatio()} fallback={
            <button type="button" class="rectangle-constraint" title="正多边形约束" aria-label="正多边形约束"
                aria-pressed={stickerToolSettings.shapeConstrainSquare}
                onClick={() => uiActions.patchStickerToolSettings({ shapeConstrainSquare: !stickerToolSettings.shapeConstrainSquare })}>
                <svg class="rectangle-number-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
                    <path d="M12 7V2m4.33 7.5 4.33-2.5m-4.33 7.5 4.33 2.5M12 17v5m-4.33-7.5L3.34 17m4.33-7.5L3.34 7" />
                </svg>
            </button>
        }><RectangleAspectRatioField shapeName={props.tool === "shape-ellipse" ? "椭圆" : "矩形"} /></Show>
        <DrawingNumberField setting="shapeSnapStep" title="步进" max={999} />
        <Show when={props.tool === "shape-polygon"}>
            <DrawingNumberField setting="polygonSides" title="边数" min={3} max={12} />
        </Show>
    </>;
};
