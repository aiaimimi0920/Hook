import { Component, For, Show } from "solid-js";
import type { Unit } from "../types/unit";
import { copyBarcodeResult, openBarcodeResultUrl, selectBarcodeResult } from "../services/barcodeResultActions";
import { getPrimaryBarcodeResult } from "../services/barcodeRecognition";

interface UnitBarcodeResultPanelProps {
    unit: Unit;
}

const MAX_VISIBLE_RESULTS = 8;

/** Displays persisted barcode results; output sockets remain owned by port rows. */
export const UnitBarcodeResultPanel: Component<UnitBarcodeResultPanelProps> = (props) => {
    const results = () => props.unit.data.barcodeResult?.results.slice(0, MAX_VISIBLE_RESULTS) ?? [];
    const totalResults = () => props.unit.data.barcodeResult?.results.length ?? 0;
    const primaryId = () => getPrimaryBarcodeResult(props.unit.data.barcodeResult)?.id;

    return (
        <Show when={results().length > 0}>
            <section class="hook-barcode-results mx-4 mb-2 border-t border-white/10 pt-2">
                <div class="mb-2 flex items-center justify-between">
                    <span class="text-[10px] font-bold uppercase tracking-wider">识别结果</span>
                    <span class="hook-inline-muted text-[9px]">{totalResults()} 个</span>
                </div>
                <div class="flex max-h-48 flex-col gap-2 overflow-y-auto">
                    <For each={results()}>
                        {(result, index) => (
                            <div class="border border-white/10 bg-black/10 p-2">
                                <div class="flex items-center justify-between gap-2 text-[9px] font-mono uppercase">
                                    <span>{index() + 1}. {result.format}</span>
                                    <span class="hook-inline-muted">{result.id === primaryId() ? "主结果" : result.url ? "URL" : "TEXT"}</span>
                                </div>
                                <div class="mt-1 max-h-10 overflow-y-auto break-all font-mono text-[10px] leading-snug" title={result.text}>
                                    {result.text}
                                </div>
                                <div class="mt-2 flex justify-end gap-1.5">
                                    <button
                                        type="button"
                                        class="hook-terminal-btn px-2 py-1 text-[9px]"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            void copyBarcodeResult(props.unit.id, result);
                                        }}
                                    >
                                        复制
                                    </button>
                                    <Show when={result.id !== primaryId()}>
                                        <button
                                            type="button"
                                            class="hook-terminal-btn px-2 py-1 text-[9px]"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                selectBarcodeResult(props.unit.id, result.id);
                                            }}
                                        >
                                            设为主结果
                                        </button>
                                    </Show>
                                    <Show when={result.url}>
                                        <button
                                            type="button"
                                            class="hook-terminal-btn hook-terminal-btn--success px-2 py-1 text-[9px]"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                void openBarcodeResultUrl(props.unit.id, result);
                                            }}
                                        >
                                            打开链接
                                        </button>
                                    </Show>
                                </div>
                            </div>
                        )}
                    </For>
                </div>
            </section>
        </Show>
    );
};
