import { Component, For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { resolveImageFrame } from "../services/ocrOverlayLayout";
import { copyBarcodeResult, openBarcodeResultUrl, selectBarcodeResult } from "../services/barcodeResultActions";
import { disposeBarcodeOverlayRects, syncBarcodeOverlayRects } from "../services/barcodeOverlayInteraction";
import { getPrimaryBarcodeResult } from "../services/barcodeRecognition";
import type { BarcodeResult, Unit } from "../types/unit";

interface BarcodeVisualOverlayProps {
    unit: Unit;
    isMinified: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Temporary, non-destructive markers for selecting and acting on decoded codes. */
export const BarcodeVisualOverlay: Component<BarcodeVisualOverlayProps> = (props) => {
    const [activeId, setActiveId] = createSignal<string | null>(null);
    let registeredRectIds: string[] = [];
    const results = () => props.unit.data.barcodeResult?.results ?? [];
    const frame = () => {
        const scan = props.unit.data.barcodeResult;
        return resolveImageFrame(props.unit, props.isMinified, scan?.width, scan?.height);
    };
    const positioned = (result: BarcodeResult) => {
        const bounds = result.bounds;
        const currentFrame = frame();
        if (!bounds || !currentFrame) return null;
        const left = currentFrame.left + bounds.left * currentFrame.scaleX;
        const top = currentFrame.top + bounds.top * currentFrame.scaleY;
        const width = Math.max((bounds.right - bounds.left) * currentFrame.scaleX, 18);
        const height = Math.max((bounds.bottom - bounds.top) * currentFrame.scaleY, 18);
        return {
            left,
            top,
            width,
            height,
            markerLeft: clamp(left, 0, Math.max(props.unit.w - 24, 0)),
            markerTop: clamp(top - 10, 0, Math.max(props.unit.h - 24, 0)),
        };
    };
    const activeResult = () => results().find((result) => result.id === activeId());
    const primaryId = () => getPrimaryBarcodeResult(props.unit.data.barcodeResult)?.id;

    createEffect(() => {
        registeredRectIds = syncBarcodeOverlayRects(
            registeredRectIds,
            props.unit,
            frame(),
            !props.isMinified && results().length > 0,
        );
    });

    onCleanup(() => disposeBarcodeOverlayRects(registeredRectIds));

    return (
        <Show when={!props.isMinified && results().length > 0}>
            <div class="pointer-events-none absolute inset-0" style={{ "z-index": 35 }}>
                <For each={results()}>
                    {(result, index) => {
                        const position = () => positioned(result);
                        return (
                            <Show when={position()}>
                                {(rect) => (
                                    <>
                                        <div
                                            class="absolute border border-[var(--signal-green)]/70"
                                            style={{
                                                left: `${rect().left}px`,
                                                top: `${rect().top}px`,
                                                width: `${rect().width}px`,
                                                height: `${rect().height}px`,
                                            }}
                                        />
                                        <button
                                            type="button"
                                            class="pointer-events-auto absolute flex h-5 min-w-5 items-center justify-center rounded-full border border-[var(--signal-green)] bg-black/80 px-1 font-mono text-[9px] font-bold text-[var(--signal-green)] shadow-lg"
                                            style={{ left: `${rect().markerLeft}px`, top: `${rect().markerTop}px` }}
                                            aria-label={`查看第 ${index() + 1} 个二维码或条码`}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setActiveId(activeId() === result.id ? null : result.id);
                                            }}
                                        >
                                            {index() + 1}
                                        </button>
                                    </>
                                )}
                            </Show>
                        );
                    }}
                </For>

                <Show when={activeResult()}>
                    {(result) => {
                        const position = () => positioned(result());
                        return (
                            <Show when={position()}>
                                {(rect) => (
                                    <div
                                        class="pointer-events-auto absolute w-64 border border-[var(--signal-green)]/50 bg-black/95 p-3 font-mono text-[10px] text-[var(--theme-text)] shadow-2xl"
                                        style={{
                                            left: `${clamp(rect().markerLeft, 0, Math.max(props.unit.w - 256, 0))}px`,
                                            top: `${clamp(rect().markerTop + 28, 0, Math.max(props.unit.h - 132, 0))}px`,
                                        }}
                                        onMouseDown={(event) => event.stopPropagation()}
                                        onClick={(event) => event.stopPropagation()}
                                    >
                                        <div class="flex items-center justify-between gap-2 text-[9px] uppercase tracking-wider text-[var(--signal-green)]">
                                            <span>{result().format}</span>
                                            <button type="button" class="text-[var(--theme-text-muted)]" onClick={() => setActiveId(null)}>×</button>
                                        </div>
                                        <div class="mt-2 max-h-16 overflow-y-auto break-all leading-snug">{result().text}</div>
                                        <div class="mt-2 flex justify-end gap-1.5">
                                            <button type="button" class="hook-terminal-btn px-2 py-1 text-[9px]" onClick={() => void copyBarcodeResult(props.unit.id, result())}>复制</button>
                                            <Show when={result().id !== primaryId()}>
                                                <button type="button" class="hook-terminal-btn px-2 py-1 text-[9px]" onClick={() => selectBarcodeResult(props.unit.id, result().id)}>设为主结果</button>
                                            </Show>
                                            <Show when={result().url}>
                                                <button type="button" class="hook-terminal-btn hook-terminal-btn--success px-2 py-1 text-[9px]" onClick={() => void openBarcodeResultUrl(props.unit.id, result())}>打开链接</button>
                                            </Show>
                                        </div>
                                        <div class="mt-2 border-t border-white/10 pt-2 text-[9px] text-[var(--theme-text-muted)]">
                                            地址也可从属性面板的 URL 输出端口连接到 Art。
                                        </div>
                                    </div>
                                )}
                            </Show>
                        );
                    }}
                </Show>
            </div>
        </Show>
    );
};
