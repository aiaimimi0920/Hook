import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js";
import { api } from "../../../platform/tauri/api";
import { longCapturePreviewLayout } from "../services/longCapturePreviewLayout";
import { longCaptureSession, setLongCaptureSession } from "../../workspace/state/uiStore";
import { LongCaptureMoveButton } from "./LongCaptureMoveButton";
import { longCaptureMoveDelta } from "../services/longCaptureMove";

/** Aggregate preview stays click-through; only viewfinder controls intercept input. */
export function LongCapturePreview() {
    const [preview, setPreview] = createSignal<{
        revision: number; width: number; height: number; dataUrl: string;
    } | null>(null);
    const [viewport, setViewport] = createSignal({ width: window.innerWidth, height: window.innerHeight });
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    onCleanup(() => window.removeEventListener("resize", resize));

    const backendId = createMemo(() => longCaptureSession()?.backendSessionId);
    const [moving, setMoving] = createSignal(false);
    const [moveError, setMoveError] = createSignal("");
    const [awaitingRevision, setAwaitingRevision] = createSignal<number | null>(null);
    createEffect(() => {
        const revision = awaitingRevision();
        if (revision !== null && (preview()?.revision ?? 0) > revision) setAwaitingRevision(null);
    });
    const delta = (sign: number, horizontal: boolean) => {
        const session = longCaptureSession();
        return session ? longCaptureMoveDelta(session.rect, horizontal, sign, viewport()) : { dx: 0, dy: 0 };
    };
    const disabled = (sign: number, horizontal: boolean) => moving() || awaitingRevision() !== null || longCaptureSession()?.status !== "capturing"
        || (delta(sign, horizontal).dx === 0 && delta(sign, horizontal).dy === 0);
    const move = async (sign: number, horizontal: boolean) => {
        const id = backendId();
        if (!id || disabled(sign, horizontal)) return;
        const { dx, dy } = delta(sign, horizontal);
        const previousRevision = preview()?.revision ?? 0;
        setMoving(true); setMoveError("");
        try {
            const rect = await api.moveLongCaptureSession(id, dx, dy);
            if (backendId() === id) {
                setLongCaptureSession((session) => session && { ...session, rect });
                setAwaitingRevision(previousRevision);
            }
        } catch {
            if (backendId() === id) setMoveError("取景框移动失败");
        } finally { if (backendId() === id) setMoving(false); }
    };
    createEffect(on(backendId, (id) => {
        setPreview(null);
        setMoveError("");
        setMoving(false);
        setAwaitingRevision(null);
        if (!id) return;
        let disposed = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let revision: number | undefined;
        // Serial polling bounds IPC/encoding and rejects stale results after cancel/restart.
        const poll = async () => {
            try {
                const result = await api.previewLongCaptureSession(id, revision);
                if (disposed) return;
                if (result) {
                    revision = result.revision;
                    setPreview(result);
                }
            } catch {
                // Keep the last successful preview; capture errors belong to the session.
                if (!disposed && awaitingRevision() !== null) setMoveError("拼接失败，请结束或取消截图");
            } finally {
                if (!disposed) timer = setTimeout(() => void poll(), 500);
            }
        };
        void poll();
        onCleanup(() => { disposed = true; clearTimeout(timer); });
    }));

    const layout = () => {
        const session = longCaptureSession();
        return session ? longCapturePreviewLayout(session.rect, viewport(), session.overlayExcluded) : null;
    };
    return <Show when={preview()}>{(image) => <Show when={layout()}>{(position) => (
        <div
            data-testid="long-capture-preview"
            class="absolute z-[2147483647] pointer-events-none overflow-hidden border border-[var(--theme-signal)] bg-black/90"
            style={{ left: `${position().x}px`, top: `${position().y}px`, width: `${position().width}px` }}
        >
            <div class="flex flex-col">
            <LongCaptureMoveButton label="向上移动取景框"
                arrow="↑" disabled={disabled(-1, false)} move={() => void move(-1, false)}
                positionKey={`${position().x},${position().y},${image().height}`} />
            <div class="flex items-center">
            <LongCaptureMoveButton label="向左移动取景框"
                arrow="←" disabled={disabled(-1, true)} move={() => void move(-1, true)}
                positionKey={`${position().x},${position().y},${image().height}`} />
            <img src={image().dataUrl} alt="当前长截图结果" draggable={false}
                class="block w-full object-contain"
                style={{ "min-width": "0", "max-height": `${Math.max(1, position().height - 80)}px` }} />
            <LongCaptureMoveButton label="向右移动取景框"
                arrow="→" disabled={disabled(1, true)} move={() => void move(1, true)}
                positionKey={`${position().x},${position().y},${image().height}`} />
            </div>
            <LongCaptureMoveButton label="向下移动取景框"
                arrow="↓" disabled={disabled(1, false)} move={() => void move(1, false)}
                positionKey={`${position().x},${position().y},${image().height}`} />
            </div>
            <div class="px-2 py-1 text-center text-[10px] text-white/80 font-mono">
                {image().width} × {image().height}
            </div>
            <Show when={moveError()}><div role="alert" class="text-xs text-red-400">{moveError()}</div></Show>
        </div>
    )}</Show>}</Show>;
}
