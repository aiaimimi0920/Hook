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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-label="Loom" role="img"><path d="M5 3v16h16M10 3v11h11M15 3v6h6" /><path d="M3 9h3M3 14h8M3 19h13" /></svg>
            <code title={connected() ? `${loomConnectionState().name}\n${loomConnectionState().loomId}` : loomConnectionState().error || "未连接"} aria-label={`Loom 唯一 ID：${connected() ? loomConnectionState().loomId : "-"}`}>{connected() ? loomConnectionState().loomId : "-"}</code>
            <button ref={(element) => { anchor = element; }} type="button" disabled={disconnecting()} onClick={() => { if (connected()) void stop(); else setOpen(!open()); }}>{connected() ? "断连" : "连接"}</button>
        </div>
        <Show when={error()}><span class="loom-error" role="alert">{error()}</span></Show>
        <Show when={open()}><ProjectionTargetPopover anchor={anchor} label="连接 Loom" close={() => setOpen(false)} fixedTarget list centerFrame={props.frame}>
            <LoomConnectionDialog close={() => setOpen(false)} />
        </ProjectionTargetPopover></Show>
    </section>;
}
