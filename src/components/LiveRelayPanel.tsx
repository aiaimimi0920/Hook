import { createResource, createSignal, For, Show, type Component } from "solid-js";

import { api } from "../services/api";
import { liveCaptureViews } from "../store/liveCaptureStore";
import { liveRelayDiscovery, liveRelayViews } from "../store/liveRelayStore";
import { surfaceStore } from "../store/surfaceStore";
import type { LiveRelayBinding } from "../services/liveRelay";
import type { LiveRelayController } from "../services/liveRelayController";
import { LiveNetworkStatus } from "./LiveNetworkStatus";
import "./LiveRelayPanel.css";

export const LiveRelayPanel: Component<{ controller: LiveRelayController }> = (props) => {
    const [extensions] = createResource(api.getLiveExtensionCapabilities);
    const [open, setOpen] = createSignal(false);
    const [selectedBinding, setSelectedBinding] = createSignal<string>();
    const [pending, setPending] = createSignal<string>();
    const [error, setError] = createSignal<string>();

    const bindings = (): LiveRelayBinding[] => Object.entries(surfaceStore.byUnit)
        .filter(([, state]) => state.lifecycle !== "disposed")
        .map(([unitId, state]) => ({
            unitId,
            instanceId: state.snapshot.instanceId,
            attachmentId: state.snapshot.attachmentId,
            label: `${state.snapshot.artId} / ${unitId}`,
        }));

    const binding = (): LiveRelayBinding | undefined => {
        const available = bindings();
        return available.find((item) => item.attachmentId === selectedBinding()) ?? available[0];
    };

    const run = async (key: string, operation: Promise<void>): Promise<void> => {
        if (pending()) return;
        setPending(key);
        setError(undefined);
        try {
            await operation;
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setPending(undefined);
        }
    };

    const isTracked = (sessionId: string): boolean =>
        liveRelayViews.some((view) => view.status.liveSessionId === sessionId);

    return (
        <aside class={`hook-live-relay-panel ${open() ? "hook-live-relay-panel--open" : ""}`}>
            <button
                type="button"
                class="hook-live-relay-panel__toggle"
                aria-expanded={open()}
                aria-controls="hook-live-relay-panel-content"
                onClick={() => setOpen(!open())}
            >
                <span class="hook-live-relay-panel__signal" aria-hidden="true" />
                LIVE
                <Show when={liveRelayViews.length > 0}>
                    <span class="hook-live-relay-panel__count">{liveRelayViews.length}</span>
                </Show>
            </button>
            <Show when={open()}>
                <div id="hook-live-relay-panel-content" class="hook-live-relay-panel__content">
                    <header>
                        <div>
                            <strong>实时协作</strong>
                            <span>LOOM.LIVE.V1 / 单控制者</span>
                        </div>
                        <button
                            type="button"
                            class="hook-terminal-btn hook-terminal-btn--active"
                            disabled={pending() !== undefined}
                            onClick={() => void run("discover", props.controller.discover())}
                        >
                            {pending() === "discover" ? "发现中" : "发现会话"}
                        </button>
                    </header>

                    <label class="hook-live-relay-panel__binding">
                        <span>Surface 绑定</span>
                        <select
                            value={binding()?.attachmentId ?? ""}
                            disabled={bindings().length === 0 || pending() !== undefined}
                            onChange={(event) => setSelectedBinding(event.currentTarget.value)}
                        >
                            <Show when={bindings().length === 0}>
                                <option value="">没有可用 Surface</option>
                            </Show>
                            <For each={bindings()}>
                                {(item) => <option value={item.attachmentId}>{item.label}</option>}
                            </For>
                        </select>
                    </label>

                    <LiveNetworkStatus />

                    <section>
                        <h3>扩展能力</h3>
                        <Show
                            when={extensions()}
                            fallback={<p class="hook-live-relay-panel__empty">正在读取本机能力边界。</p>}
                        >
                            {(report) => (
                                <>
                                    <p class="hook-live-relay-panel__capability-summary">
                                        已启用 {report().capabilities.filter((item) => item.availability === "available").length}
                                        {` / 未启用 ${report().capabilities.filter((item) => item.availability === "unavailable").length}`}
                                    </p>
                                    <For each={report().capabilities}>
                                        {(capability) => (
                                            <div class="hook-live-relay-panel__capability">
                                                <span>{capability.id}</span>
                                                <strong class={`hook-live-relay-panel__capability-state hook-live-relay-panel__capability-state--${capability.availability}`}>
                                                    {capability.availability === "available" ? "可用" : "未启用"}
                                                </strong>
                                            </div>
                                        )}
                                    </For>
                                </>
                            )}
                        </Show>
                    </section>

                    <section>
                        <h3>本机发布</h3>
                        <Show when={liveCaptureViews.length > 0} fallback={<p class="hook-live-relay-panel__empty">先框选窗口并启动实时截图。</p>}>
                            <For each={liveCaptureViews}>
                                {(capture) => {
                                    const existing = () => liveRelayViews.find((view) =>
                                        view.status.role === "source"
                                        && view.status.captureSessionId === capture.sessionId);
                                    return (
                                        <div class="hook-live-relay-panel__row">
                                            <div>
                                                <strong>{capture.status.sourceTitle ?? capture.sessionId}</strong>
                                                <span>{capture.status.width}×{capture.status.height} / {capture.status.captureState}</span>
                                            </div>
                                            <Show
                                                when={existing()}
                                                fallback={(
                                                    <button
                                                        type="button"
                                                        class="hook-terminal-btn"
                                                        disabled={!binding() || pending() !== undefined}
                                                        onClick={() => {
                                                            const selected = binding();
                                                            if (!selected) return;
                                                            void run(`publish:${capture.sessionId}`, props.controller.publish(
                                                                capture.sessionId,
                                                                capture.status.sourceTitle ?? "本机实时画面",
                                                                capture.status,
                                                                selected,
                                                            ));
                                                        }}
                                                    >发布</button>
                                                )}
                                            >
                                                {(relay) => (
                                                    <div class="hook-live-relay-panel__actions">
                                                        <button
                                                            type="button"
                                                            class="hook-terminal-btn hook-terminal-btn--danger"
                                                            disabled={pending() !== undefined}
                                                            onClick={() => void run(`reclaim:${relay().relayId}`, props.controller.reclaim(relay().relayId))}
                                                        >本机收回</button>
                                                        <button
                                                            type="button"
                                                            class="hook-terminal-btn"
                                                            disabled={pending() !== undefined}
                                                            onClick={() => void run(`stop:${relay().relayId}`, props.controller.stop(relay().relayId))}
                                                        >停止</button>
                                                    </div>
                                                )}
                                            </Show>
                                        </div>
                                    );
                                }}
                            </For>
                        </Show>
                    </section>

                    <section>
                        <h3>可加入会话</h3>
                        <Show when={liveRelayDiscovery.sessions.length > 0} fallback={<p class="hook-live-relay-panel__empty">点击“发现会话”读取 Loom 当前状态。</p>}>
                            <For each={liveRelayDiscovery.sessions.filter((item) => !item.closed)}>
                                {(item) => (
                                    <div class="hook-live-relay-panel__row">
                                        <div>
                                            <strong>{item.session.sourceWindowIdentity.title ?? item.session.sourceHookId}</strong>
                                            <span>
                                                {item.sourceConnected ? "源在线" : "源离线"}
                                                {` / ${item.session.viewerDevices.length} 查看者 / UIA ${item.session.observationCapabilities.length} 能力`}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            class="hook-terminal-btn"
                                            disabled={!binding() || !item.sourceConnected || isTracked(item.session.sessionId) || pending() !== undefined}
                                            onClick={() => {
                                                const selected = binding();
                                                if (selected) void run(`join:${item.session.sessionId}`, props.controller.join(item, selected));
                                            }}
                                        >{isTracked(item.session.sessionId) ? "已连接" : "加入"}</button>
                                    </div>
                                )}
                            </For>
                        </Show>
                    </section>

                    <Show when={error()}>
                        {(message) => <p class="hook-live-relay-panel__error" role="alert">{message()}</p>}
                    </Show>
                </div>
            </Show>
        </aside>
    );
};
