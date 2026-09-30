import { createSignal, For, Show } from "solid-js";
import { deliveryBusy, deliveryError, deliveryPending, deliverySettings } from "../store/projectionDeliveryStore";
import { decideDelivery } from "../services/projectionDeliveryReceiver";
import { projectionError } from "../services/qrProjectionProtocol";
import { pauseProjectionReceiver, projectionReceiverPaused } from "../store/managedProjectionReceiverStore";

export const ProjectionReceiveSettings = () => {
    const [error, setError] = createSignal("");
    return <section aria-label="设备投送接收设置">
        <p>自动使用当前连接的 Loom。自动接受、确认、拒绝和名单请在 Loom 的“投射规则”中配置。</p>
        <p>当前 Loom：{deliverySettings().origin || "等待连接"}</p>
        <button type="button" class="hook-terminal-btn" disabled={deliveryBusy()} onClick={() => {
            try { pauseProjectionReceiver(!projectionReceiverPaused()); setError(""); } catch (reason) { setError(projectionError(reason)); }
        }}>{projectionReceiverPaused() ? "恢复本机接收" : "暂停本机接收"}</button>
        <p role="status">{projectionReceiverPaused() ? "本机已暂停接收" : deliverySettings().policy === "disabled" ? "正在读取 Loom 连接" : "由 Loom 决定每次投射的接收方式 · 关闭面板后继续接收"}</p>
        <For each={deliveryPending()}>{(item) => <div>
            <p>{item.sourceName} 请求投送{item.envelope.content.kind === "art" ? " Art 图像" : "贴图"}并持续同步。</p>
            <button type="button" class="hook-terminal-btn" disabled={deliveryBusy()} onClick={() => void decideDelivery(item, true)}>接收并显示</button>
            <button type="button" class="hook-terminal-btn" disabled={deliveryBusy() || item.accepted} onClick={() => void decideDelivery(item, false)}>拒绝</button>
        </div>}</For>
        <Show when={error() || deliveryError()}><p role="alert">{error() || projectionError(deliveryError())}</p></Show>
    </section>;
};
