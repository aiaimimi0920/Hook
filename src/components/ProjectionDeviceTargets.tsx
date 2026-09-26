import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { deliveryTargets, type DeliveryTarget } from "../services/projectionDeliveryApi";
import { projectionError } from "../services/qrProjectionProtocol";

export const ProjectionDeviceTargets = (props: { origin: string; busy: boolean; send: (id: string, target?: DeliveryTarget) => void }) => {
    const [targets, setTargets] = createSignal<DeliveryTarget[]>([]);
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal("");
    const [partial, setPartial] = createSignal(false);
    let generation = 0;
    let alive = true;
    createEffect(() => { void props.origin; generation += 1; setTargets([]); setError(""); setLoading(false); setPartial(false); });
    onCleanup(() => { alive = false; });
    const refresh = async () => {
        const attempt = ++generation;
        setLoading(true); setError(""); setPartial(false);
        try { const result = await deliveryTargets(props.origin); if (alive && generation === attempt) { setTargets(result.targets); setPartial(result.status !== "complete"); } }
        catch (reason) { if (alive && generation === attempt) setError(projectionError(reason)); }
        finally { if (alive && generation === attempt) setLoading(false); }
    };
    return <section aria-label="设备投送">
        <p>投送并持续同步。接收端须先在接收面板启用同一 Loom 的设备投送。</p>
        <button class="hook-terminal-btn" type="button" disabled={props.busy || loading() || !props.origin} onClick={() => void refresh()}>
            {loading() ? "正在查找设备…" : "刷新可接收设备"}</button>
        <For each={targets()}>{(target) => <div>
            <button class="hook-terminal-btn" type="button" disabled={props.busy || (target.route === "offline_peer" && !target.deliveryAvailable)}
                onClick={() => { if (target.route === "shared_loom") props.send(target.deviceId); else if (target.deliveryAvailable) props.send(target.deviceId, target); }}>
                {target.route === "offline_peer" ? "远端设备：" : "投送到 "}{target.name} · {target.policy === "auto" ? "自动接收" : "需确认"}</button>
            {target.route === "offline_peer"
                ? <p>来自 {target.peerName} · {target.deliveryAvailable ? "已验证，可跨 Loom 投送" : "目录已验证，跨 Loom 投送尚未接通"}</p> : null}
        </div>}</For>
        <Show when={partial()}><p role="status">部分对等 Loom 目录暂不可用；当前显示已验证的设备。</p></Show>
        <Show when={error()}><p role="alert">{error()}</p></Show>
    </section>;
};
