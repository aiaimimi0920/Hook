import { For, Show, createSignal, onCleanup, onMount, untrack } from "solid-js";
import { listenSystemClipboard, readSystemClipboardHistory, type SystemClipboardEntry } from "../../workspace/services/systemClipboardHistory";
import { pasteSystemClipboardEntry } from "../services/stickerClipboardPaste";
import { OverlayMenuScrollArea } from "../../../platform/desktop/OverlayMenuScrollArea";

// A mounted submenu owns one read at a time. Events coalesce, and late results are discarded.
export const StickerClipboardHistoryPanel = (props: { unitId: string; onDone: () => void }) => {
    const [entries, setEntries] = createSignal<SystemClipboardEntry[]>([]);
    const [notice, setNotice] = createSignal("读取中…");
    const [busy, setBusy] = createSignal(false);
    let alive = true;
    let reading = false;
    let pending = false;
    let unlisten: (() => void) | undefined;
    const refresh = async () => {
        if (!alive) return;
        if (reading) { pending = true; return; }
        reading = true;
        try {
            const snapshot = await readSystemClipboardHistory();
            if (!alive) return;
            setEntries(snapshot.entries);
            setNotice(snapshot.status === "disabled" ? "请先在 Windows 设置中开启剪贴板历史"
                : snapshot.status === "denied" ? "无法访问系统剪贴板历史"
                    : snapshot.status === "unsupported" ? "仅支持 Windows 桌面端"
                        : snapshot.monitoring === false ? "系统剪贴板监听不可用"
                            : snapshot.entries.length ? "" : "暂无图片或文字");
        } catch {
            if (alive) { setEntries([]); setNotice("读取剪贴板失败"); }
        } finally {
            reading = false;
            if (alive && pending) { pending = false; void refresh(); }
        }
    };
    onMount(() => {
        void listenSystemClipboard(() => { void refresh(); }).then((stop) => {
            if (!alive) stop(); else { unlisten = stop; void refresh(); }
        }).catch(() => { if (alive) setNotice("剪贴板监听不可用"); });
    });
    onCleanup(() => { alive = false; unlisten?.(); });
    const paste = async (entry: SystemClipboardEntry) => {
        if (busy()) return;
        const target = props.unitId;
        setBusy(true);
        try {
            await pasteSystemClipboardEntry(target, entry, () => alive && untrack(() => props.unitId) === target);
            if (alive) props.onDone();
        } catch {
            if (alive) setNotice("粘贴失败，请重试");
        } finally { if (alive) setBusy(false); }
    };
    return <div class="otter-context-menu-shell w-[260px] p-1" aria-label="系统剪贴板历史">
        <OverlayMenuScrollArea label="剪贴板历史滚动条" maxHeight="min(380px, calc(var(--sticker-menu-max-height, 390px) - 10px))">
        <div class="flex flex-col gap-1">
        <Show when={notice()}><div class="px-2 py-2 text-xs" role="status">{notice()}</div></Show>
        <For each={entries()}>{(entry) => <button type="button"
            class="otter-terminal-list-item min-h-[48px] shrink-0 overflow-hidden px-2 py-1 text-left text-sm"
            disabled={busy()} onClick={() => void paste(entry)}>
            <Show when={entry.kind === "image"} fallback={<span class="line-clamp-3 whitespace-pre-wrap break-all">{entry.content.slice(0, 240)}</span>}>
                <img class="h-[72px] w-full object-contain" src={entry.preview ?? entry.content} alt="剪贴板图片" draggable={false} />
            </Show>
        </button>}</For>
        </div>
        </OverlayMenuScrollArea>
    </div>;
};
