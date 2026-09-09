import { createResource, For, Show, type Component } from "solid-js";

import { api } from "../services/api";
import { liveRelayViews } from "../store/liveRelayStore";

const latencyLabel = (state: string, roundTrip?: number | null): string => {
    if (state === "unavailable") return "RTT 不适用";
    if (state === "measuring" || roundTrip === undefined || roundTrip === null) return "RTT 测量中";
    return `RTT ${roundTrip} ms / ${state}`;
};

const scopeLabel = (scope: string): string => {
    switch (scope) {
        case "loopback_http": return "仅本机 HTTP（无远程能力）";
        case "loopback_https": return "本机 HTTPS";
        case "private_https": return "非本机 HTTPS + 设备认证";
        default: return "Loom 网络端点未配置";
    }
};

export const LiveNetworkStatus: Component = () => {
    const [network] = createResource(api.getLiveNetworkCapabilities);

    return (
        <section>
            <h3>网络状态</h3>
            <Show when={network()} fallback={<p class="hook-live-relay-panel__empty">正在读取网络安全边界。</p>}>
                {(report) => (
                    <>
                        <p class="hook-live-relay-panel__capability-summary">
                            {scopeLabel(report().configuredScope)} / 局域网不依赖云端
                        </p>
                        <For each={report().transports}>
                            {(transport) => (
                                <div class="hook-live-relay-panel__capability">
                                    <span>{transport.id}</span>
                                    <strong class={`hook-live-relay-panel__capability-state hook-live-relay-panel__capability-state--${transport.availability}`}>
                                        {transport.availability === "available" ? "可用" : "未配置"}
                                    </strong>
                                </div>
                            )}
                        </For>
                        <For each={liveRelayViews}>
                            {(view) => (
                                <div class="hook-live-relay-panel__network-session">
                                    <strong>{view.title}</strong>
                                    <span>{view.status.mediaTransport} / {view.status.networkScope}</span>
                                    <span>{latencyLabel(view.status.latencyState, view.status.roundTripLatencyMs)}</span>
                                </div>
                            )}
                        </For>
                        <p class="hook-live-relay-panel__privacy">
                            帧/OCR 云端留存关闭 · 遥测关闭 · 凭据不出现在报告中
                        </p>
                    </>
                )}
            </Show>
        </section>
    );
};
