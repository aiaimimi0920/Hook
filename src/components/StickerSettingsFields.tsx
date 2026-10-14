import { Show, type Component, type JSX } from "solid-js";
import { FlipXIcon, FlipYIcon, OpacityIcon, RadiusIcon, StrokeColorIcon } from "./stickerTopStripPropertyBarIcons";
import type { createPropertyBarCropController } from "./stickerTopStripPropertyBarCropController";

export const StickerSettingsIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <path d="M3 6h4m5 0h9M3 12h10m5 0h3M3 18h4m5 0h9" />
    <circle cx="9.5" cy="6" r="2.5" /><circle cx="15.5" cy="12" r="2.5" /><circle cx="9.5" cy="18" r="2.5" />
</svg>;

const SettingNumber: Component<{
    label: string; value: number; draft: string | null; icon: JSX.Element;
    setDraft: (value: string | null) => void; commit: () => void; percent?: boolean;
}> = (props) => {
    const step = (direction: number) => { props.commit(); props.setDraft(String(props.value + direction)); props.commit(); };
    return <label class="sticker-settings-number">
        {props.icon}
        <input aria-label={props.label} inputmode="numeric" value={props.draft ?? props.value}
            onInput={(event) => props.setDraft(event.currentTarget.value)} onBlur={() => props.commit()}
            onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); props.commit(); event.currentTarget.blur(); }
                if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); step(event.key === "ArrowUp" ? 1 : -1); }
            }} />
        <Show when={props.percent}><span>%</span></Show>
        <span class="rectangle-steppers">
            <button type="button" aria-label={`增加${props.label}`} onClick={() => step(1)}><svg viewBox="0 0 12 8"><path d="m1 7 5-6 5 6Z" /></svg></button>
            <button type="button" aria-label={`减少${props.label}`} onClick={() => step(-1)}><svg viewBox="0 0 12 8"><path d="m1 1 5 6 5-6Z" /></svg></button>
        </span>
    </label>;
};

export const StickerSettingsFields: Component<{
    controller: ReturnType<typeof createPropertyBarCropController>;
    height: number; flippedX: boolean; flippedY: boolean;
    fitButton?: JSX.Element;
}> = (props) => {
    const c = () => props.controller;
    return <>
        <div class="sticker-settings-actions">
            <button type="button" aria-label="水平镜像" aria-pressed={props.flippedX} onClick={() => void c().applyCropFlip("x")}><FlipXIcon /></button>
            <button type="button" aria-label="垂直镜像" aria-pressed={props.flippedY} onClick={() => void c().applyCropFlip("y")}><FlipYIcon /></button>
            <button type="button" aria-label="外边框" aria-pressed={c().isCropBorderEnabled()} onClick={() => c().toggleCropBorder()}><StrokeColorIcon /></button>
            {props.fitButton}
        </div>
        <SettingNumber label="宽度" value={c().getEditableCanvasWidth()} draft={c().cropCanvasWidthDraft()} setDraft={c().setCropCanvasWidthDraft} commit={c().commitCropCanvasWidthDraft}
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 5v14m16-14v14M4 12h16m-12-4-4 4 4 4m8-8 4 4-4 4" /></svg>} />
        <label class="sticker-settings-number sticker-settings-linked">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m10 14 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" /></svg>
            <input aria-label="等比高度" readOnly value={Math.round(props.height)} />
        </label>
        <SettingNumber label="不透明度" value={c().getEditableOpacityPercent()} draft={c().cropOpacityDraft()} setDraft={c().setCropOpacityDraft} commit={c().commitCropOpacityDraft} percent icon={<OpacityIcon />} />
        <SettingNumber label="圆角" value={c().getEditableFrameCornerRadius()} draft={c().cropCornerRadiusDraft()} setDraft={c().setCropCornerRadiusDraft} commit={c().commitCropCornerRadiusDraft} icon={<RadiusIcon />} />
    </>;
};
