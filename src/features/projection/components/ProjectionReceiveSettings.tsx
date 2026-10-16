import { createSignal, For, Show } from "solid-js";
import { deliveryBusy, deliveryError, deliveryPending, deliverySettings } from "../state/projectionDeliveryStore";
import { decideDelivery } from "../services/projectionDeliveryReceiver";
import { projectionError } from "../services/qrProjectionProtocol";
import { pauseProjectionReceiver, projectionReceiverPaused } from "../state/managedProjectionReceiverStore";
import { ProjectionReceivePolicyControl } from "./ProjectionReceivePolicyControl";

export const ProjectionReceiveSettings = () => {
    const [error, setError] = createSignal("");
    return <section aria-label="设备投送接收设置">
        <ProjectionReceivePolicyControl />
        <p>当前 Loom：{deliverySettings().origin || "等待连接"}</p>
        <button type="button" class="otter-terminal-btn" disabled={deliveryBusy()} onClick={() => {
            try { pauseProjectionReceiver(!projectionReceiverPaused()); setError(""); } catch (reason) { setError(projectionError(reason)); }
        }}>{projectionReceiverPaused() ? "恢复本机接收" : "暂停本机接收"}</button>
        <p role="status">{projectionReceiverPaused() ? "本机已暂停接收" : deliverySettings().policy === "disabled" ? "正在读取 Loom 连接" : "关闭面板后继续接收"}</p>
        <For each={deliveryPending()}>{(item) => <div>
            <p>{item.sourceName} 请求投送{item.envelope.content.kind === "art" ? " Art 图像" : "贴图"}并持续同步。</p>
            <button type="button" class="otter-terminal-btn" disabled={deliveryBusy()} onClick={() => void decideDelivery(item, true)}>接收并显示</button>
            <button type="button" class="otter-terminal-btn" disabled={deliveryBusy() || item.accepted} onClick={() => void decideDelivery(item, false)}>拒绝</button>
        </div>}</For>
        <Show when={error() || deliveryError()}><p role="alert">{error() || projectionError(deliveryError())}</p></Show>
    </section>;
};
