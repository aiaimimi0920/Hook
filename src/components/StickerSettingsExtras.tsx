import { For, Show, createSignal, onCleanup, type Component } from "solid-js";
import type { Unit } from "../types/unit";
import { api } from "../services/api";
import { stickerExtraText, type StickerExtraTextKind } from "../services/stickerExtraText";

const actions: { id: StickerExtraTextKind; label: string; shortLabel: string }[] = [
    { id: "ocr", label: "复制 OCR 全文", shortLabel: "原文" },
    { id: "translation", label: "复制翻译全文", shortLabel: "译文" },
];

/** Additional sticker actions live here, separately from frame appearance fields. */
export const StickerSettingsExtras: Component<{ unit: Unit | undefined }> = (props) => {
    const [pending, setPending] = createSignal<StickerExtraTextKind>();
    const [feedback, setFeedback] = createSignal<{ id: StickerExtraTextKind; label: string }>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    onCleanup(() => { disposed = true; clearTimeout(timer); });
    const copy = async (id: StickerExtraTextKind) => {
        const value = stickerExtraText(props.unit, id);
        if (pending() || !value) return;
        clearTimeout(timer); setFeedback(undefined); setPending(id);
        let copied = false;
        try { copied = await api.copyTextToClipboard(value); }
        catch { /* Clipboard failures are reported in the clicked button. */ }
        if (disposed) return;
        setPending(undefined);
        setFeedback({ id, label: copied ? "已复制" : "复制失败" });
        timer = setTimeout(() => setFeedback(undefined), 1600);
    };
    return <section class="sticker-settings-extras" aria-label="额外容器">
        <For each={actions}>{(action) => <button type="button" aria-label={action.label}
            title={feedback()?.id === action.id ? `${action.label}：${feedback()?.label}` : action.label}
            disabled={!!pending() || !stickerExtraText(props.unit, action.id)} aria-busy={pending() === action.id}
            onClick={() => void copy(action.id)}>
            <Show when={feedback()?.id !== action.id}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d={action.id === "ocr" ? "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8M8 12h8M8 16h5"
                    : "M3 5h11M8 3v2m3 0c-1 6-4 9-8 11m2-8c1 3 4 6 7 7m1 6 4-11 4 11m-6.5-4h5"} />
            </svg></Show>
            <span aria-live="polite">{feedback()?.id === action.id ? feedback()?.label : action.shortLabel}</span>
        </button>}</For>
    </section>;
};
