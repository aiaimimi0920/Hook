import { createSignal, For, onCleanup, Show } from "solid-js";
import { deliveryBusy, deliveryError, deliveryPending, deliverySettings, saveDeliverySettings } from "../store/projectionDeliveryStore";
import { decideDelivery } from "../services/projectionDeliveryReceiver";
import { projectionContext } from "../services/qrProjectionApi";
import { projectionError } from "../services/qrProjectionProtocol";
import type { ReceivePolicy } from "../services/projectionDeliveryApi";

export const ProjectionReceiveSettings = () => {
    const [origin, setOrigin] = createSignal(deliverySettings().origin);
    const [policy, setPolicy] = createSignal<ReceivePolicy>(deliverySettings().policy);
    const [error, setError] = createSignal("");
    const [saving, setSaving] = createSignal(false);
    let alive = true;
    onCleanup(() => { alive = false; });
    const save = async () => {
        if (saving() || deliveryBusy()) return;
        const requestedPolicy = policy();
        setError(""); setSaving(true);
        try {
            const address = origin().trim() || await projectionContext();
            if (alive) { saveDeliverySettings(address, requestedPolicy); setOrigin(address); }
        } catch (reason) { if (alive) setError(projectionError(reason)); }
        finally { if (alive) setSaving(false); }
    };
    return <section aria-label="设备投送接收设置">
        <p>启用后，已配对到此 Loom 的其他设备可以投送关联贴图。无需官方账号。</p>
        <label class="qr-projection-field">接收 Loom 地址<input value={origin()} maxLength={256} disabled={deliveryBusy() || saving()}
            placeholder="留空使用当前 Loom" onInput={(event) => setOrigin(event.currentTarget.value)} /></label>
        <label class="qr-projection-field">接收策略<select value={policy()} disabled={deliveryBusy() || saving()} onChange={(event) => setPolicy(event.currentTarget.value as ReceivePolicy)}>
            <option value="disabled">关闭设备投送</option><option value="confirm">弹出接收确认</option><option value="auto">自动接收并显示</option>
        </select></label>
        <button type="button" class="hook-terminal-btn" disabled={deliveryBusy() || saving()} onClick={() => void save()}>保存接收设置</button>
        <p role="status">{deliverySettings().policy === "disabled" ? "设备投送已关闭" : "设备投送已启用 · 关闭面板后继续接收"}</p>
        <For each={deliveryPending()}>{(item) => <div>
            <p>{item.sourceName} 请求投送{item.envelope.content.kind === "art" ? " Art 图像" : "贴图"}并持续同步。</p>
            <button type="button" class="hook-terminal-btn" disabled={deliveryBusy()} onClick={() => void decideDelivery(item, true)}>接收并显示</button>
            <button type="button" class="hook-terminal-btn" disabled={deliveryBusy() || item.accepted} onClick={() => void decideDelivery(item, false)}>拒绝</button>
        </div>}</For>
        <Show when={error() || deliveryError()}><p role="alert">{error() || projectionError(deliveryError())}</p></Show>
    </section>;
};
