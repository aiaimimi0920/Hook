import { createSignal, Show } from "solid-js";
import { disconnectLoom, loomConnectionState, useLoomConnection } from "../services/loomConnection";
import { ProjectionTargetPopover } from "./ProjectionTargetPopover";
import { LoomConnectionDialog } from "./LoomConnectionDialog";
import type { ProjectionSettingsFrame } from "./ProjectionSettings";
import "../styles/loom-connection.css";

export function LoomConnectionSettings(props: { frame: ProjectionSettingsFrame }) {
    useLoomConnection();
    const [open, setOpen] = createSignal(false);
    const [error, setError] = createSignal("");
    const [disconnecting, setDisconnecting] = createSignal(false);
    let anchor!: HTMLButtonElement;
    const connected = () => loomConnectionState().phase === "connected";
    const stop = async () => {
        setDisconnecting(true); setError("");
        try { await disconnectLoom(); } catch (reason) { setError(String(reason)); }
        finally { setDisconnecting(false); }
    };
    return <section class="sticker-settings-panel" aria-label="Loom 全局连接">
        <div class="loom-settings-row">
            {/* Loom's canonical anvil and spark, matching its desktop LoomMark. */}
            <svg viewBox="0 0 1024 1024" aria-label="Loom" role="img">
                <path d="M196 330h632c-38 96-130 148-270 158v108h106l96 194H264l96-194h106V488H318L196 330Z" fill="currentColor" />
                <path d="m690 206 30 66 72 8-54 48 16 70-64-36-64 36 16-70-54-48 72-8 30-66Z" fill="var(--theme-signal, #d9ff38)" />
            </svg>
            <code title={connected() ? `${loomConnectionState().name}\n${loomConnectionState().loomId}` : loomConnectionState().error || "未连接"} aria-label={`Loom 唯一 ID：${connected() ? loomConnectionState().loomId : "-"}`}>{connected() ? loomConnectionState().loomId : "-"}</code>
            <button ref={(element) => { anchor = element; }} type="button" disabled={disconnecting()} onClick={() => { if (connected()) void stop(); else setOpen(!open()); }}>{connected() ? "断连" : "连接"}</button>
        </div>
        <Show when={error()}><span class="loom-error" role="alert">{error()}</span></Show>
        <Show when={open()}><ProjectionTargetPopover anchor={anchor} label="连接 Loom" close={() => setOpen(false)} fixedTarget list centerFrame={props.frame}>
            <LoomConnectionDialog close={() => setOpen(false)} />
        </ProjectionTargetPopover></Show>
    </section>;
}
