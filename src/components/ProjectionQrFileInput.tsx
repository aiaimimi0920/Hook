import { createSignal, onCleanup, Show } from "solid-js";
import { importProjectionQr } from "../services/projectionQrImport";
import { projectionError } from "../services/qrProjectionProtocol";

export const ProjectionQrFileInput = (props: { disabled: boolean; imported: (text: string) => void; preparing?: () => void; compact?: boolean }) => {
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal("");
    const [filename, setFilename] = createSignal("");
    let input!: HTMLInputElement;
    let active: AbortController | undefined;
    onCleanup(() => active?.abort());
    const load = async (file?: File) => {
        if (!file || props.disabled || busy()) return;
        active?.abort(); active = new AbortController();
        const request = active;
        props.preparing?.();
        setFilename("");
        setBusy(true); setError("");
        try {
            const text = await importProjectionQr(file, request.signal);
            if (!request.signal.aborted) { setFilename(file.name); props.imported(text); }
        } catch (reason) { if (!request.signal.aborted) setError(projectionError(reason)); }
        finally { if (!request.signal.aborted) setBusy(false); }
    };
    return <>
        <Show when={props.compact}><button type="button" class="hook-terminal-btn min-w-0 truncate" title={filename() || "选择 PNG 图片"}
            disabled={props.disabled || busy()} onClick={() => input.click()}>{busy() ? "识别中…" : filename() || "选择图片"}</button></Show>
        <label class={props.compact ? "hidden" : "qr-projection-field"}><Show when={!props.compact}>导入二维码图片（PNG）</Show>
            <input ref={input} type="file" accept="image/png,.png" disabled={props.disabled || busy()} aria-label="导入二维码图片"
                onChange={(event) => { void load(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
        </label>
        <Show when={busy() && !props.compact}><p role="status">正在本地识别二维码…</p></Show>
        <Show when={error()}><p role="alert">{error()}</p></Show>
    </>;
};
