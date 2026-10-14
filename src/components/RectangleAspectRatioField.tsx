import { For, Show, createSignal } from "solid-js";
import { stickerToolSettings, uiActions } from "../store/uiStore";
import { parseRectangleAspectRatio } from "../services/rectangleAspectRatio";

/** 图标切换约束，比例输入按当前图形的工具配置独立保存。 */
export const RectangleAspectRatioField = (props: { shapeName?: string }) => {
    const [draft, setDraft] = createSignal<Partial<Record<"width" | "height", string>>>({});
    const value = (part: "width" | "height") =>
        (parseRectangleAspectRatio(stickerToolSettings.shapeAspectRatio)?.text ?? "1:1").split(":")[part === "width" ? 0 : 1];
    const text = () => `${draft().width ?? value("width")}:${draft().height ?? value("height")}`;
    const commit = () => {
        if (draft().width === undefined && draft().height === undefined) return;
        const parsed = parseRectangleAspectRatio(text());
        setDraft({});
        if (parsed) uiActions.patchStickerToolSettings({
            shapeAspectRatio: parsed.text.split(":").map((part) => Math.min(999, Number(part))).join(":"),
            shapeConstrainSquare: true,
        });
    };
    const step = (part: "width" | "height", direction: number) => {
        const parts = (parseRectangleAspectRatio(text())?.text ?? `${value("width")}:${value("height")}`).split(":");
        const index = part === "width" ? 0 : 1;
        const current = Number(parts[index]);
        const minimum = Number.isInteger(current) ? 1 : 0.01;
        parts[index] = String(Number(Math.min(999, Math.max(minimum, current + direction)).toFixed(10)));
        setDraft({});
        uiActions.patchStickerToolSettings({ shapeAspectRatio: parts.join(":"), shapeConstrainSquare: true });
    };
    return <div class="rectangle-ratio-field" classList={{ "rectangle-ratio-enabled": stickerToolSettings.shapeConstrainSquare }}>
        <button type="button" aria-label={`约束${props.shapeName ?? "矩形"}宽高比`} aria-pressed={stickerToolSettings.shapeConstrainSquare}
            title={stickerToolSettings.shapeConstrainSquare ? "取消比例约束" : "启用比例约束"}
            onClick={() => uiActions.patchStickerToolSettings({ shapeConstrainSquare: !stickerToolSettings.shapeConstrainSquare })}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="6" y="4" width="15" height="11" rx="1.5" />
                <path d="M6 20h15m-13-2-2 2 2 2m11-4 2 2-2 2M2 4v11M0 6l2-2 2 2m-4 7 2 2 2-2" />
            </svg>
        </button>
        <For each={["width", "height"] as const}>{(part) => <>
            <Show when={part === "height"}><span class="rectangle-ratio-colon" aria-hidden="true">:</span></Show>
            <span class="rectangle-ratio-number" classList={{ "rectangle-ratio-number-leading": part === "width" }}>
            <input aria-label={part === "width" ? "比例宽度" : "比例高度"} title={part === "width" ? "比例宽度" : "比例高度"}
                type="text" inputmode="numeric" maxlength={3}
                value={draft()[part] ?? value(part)}
                aria-invalid={draft()[part] !== undefined && !parseRectangleAspectRatio(text())}
                onInput={(event) => {
                    const next = event.currentTarget.value;
                    if (/^\d{0,3}$/.test(next)) setDraft((current) => ({ ...current, [part]: next }));
                    else event.currentTarget.value = draft()[part] ?? value(part);
                }}
                onBlur={commit}
                onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                        event.preventDefault();
                        step(part, event.key === "ArrowUp" ? 1 : -1);
                    }
                    if (event.key === "Enter") { commit(); event.currentTarget.blur(); }
                    if (event.key === "Escape") { setDraft({}); event.currentTarget.blur(); }
                }} />
                <span class="rectangle-steppers">
                    <button type="button" aria-label={part === "width" ? "增加比例宽度" : "增加比例高度"} onClick={() => step(part, 1)}>
                        <svg viewBox="0 0 12 8" aria-hidden="true"><path d="m1 7 5-6 5 6Z" /></svg>
                    </button>
                    <button type="button" aria-label={part === "width" ? "减少比例宽度" : "减少比例高度"} onClick={() => step(part, -1)}>
                        <svg viewBox="0 0 12 8" aria-hidden="true"><path d="m1 1 5 6 5-6Z" /></svg>
                    </button>
                </span>
            </span>
        </>}</For>
    </div>;
};
