import {
    Show,
    createEffect,
    createSignal,
    onCleanup,
    onMount,
    type Component,
} from "solid-js";

import { acceptsSurfaceRelayedKeydown } from "../services/surfaceHostKeydown";
import type { SurfaceConfirmationRequest } from "../services/surfaceProtocol";
import "./SurfaceConfirmationDialog.css";

interface Props {
    request?: SurfaceConfirmationRequest;
    submitting?: boolean;
    error?: string;
    onDecision: (approved: boolean) => void;
}

const riskLabel = (risk: SurfaceConfirmationRequest["risk"]): string => {
    switch (risk) {
        case "high": return "高风险";
        case "medium": return "需要确认";
        default: return "权限确认";
    }
};

const payloadSummary = (payload: unknown): string | undefined => {
    if (payload === undefined || payload === null) return undefined;
    try {
        const serialized = JSON.stringify(payload, null, 2);
        return serialized.length > 2_000 ? `${serialized.slice(0, 2_000)}\n…` : serialized;
    } catch {
        return "无法显示操作参数";
    }
};

export const SurfaceConfirmationDialog: Component<Props> = (props) => {
    let rejectButton: HTMLButtonElement | undefined;
    let previousFocus: HTMLElement | null = null;
    const [now, setNow] = createSignal(Date.now());

    const expired = () => Boolean(props.request && props.request.expiresAtMs <= now());
    const remainingSeconds = () => props.request
        ? Math.max(0, Math.ceil((props.request.expiresAtMs - now()) / 1_000))
        : 0;

    createEffect(() => {
        if (!props.request) return;
        previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        queueMicrotask(() => rejectButton?.focus());
    });

    onMount(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1_000);
        const handleKeyDown = (event: KeyboardEvent) => {
            // A surface must not be able to answer its own permission prompt, not even
            // with the safe answer, so the sandbox keydown relay is not opted in here.
            if (!acceptsSurfaceRelayedKeydown(event)) return;
            if (!props.request || event.key !== "Escape" || props.submitting) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            props.onDecision(false);
        };
        window.addEventListener("keydown", handleKeyDown, true);
        onCleanup(() => {
            window.clearInterval(timer);
            window.removeEventListener("keydown", handleKeyDown, true);
            previousFocus?.focus();
        });
    });

    return (
        <Show when={props.request}>
            {(request) => (
                <div class="surface-confirmation-backdrop" role="presentation">
                    <section
                        class="surface-confirmation-dialog"
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby="surface-confirmation-title"
                        aria-describedby="surface-confirmation-description"
                        onMouseDown={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                    >
                        <header class="surface-confirmation-header">
                            <span class="surface-confirmation-signal" aria-hidden="true">!</span>
                            <div>
                                <div class="surface-confirmation-kicker">HOOK / HOST CONFIRMATION</div>
                                <h2 id="surface-confirmation-title">操作确认</h2>
                            </div>
                            <span class="surface-confirmation-risk">{riskLabel(request().risk)}</span>
                        </header>

                        <div class="surface-confirmation-content">
                            <p id="surface-confirmation-description">
                                Art 请求执行 <strong>{request().actionId}</strong>。确认由 Hook 宿主显示，
                                Art 无法替换或模拟此界面。
                            </p>
                            <dl class="surface-confirmation-meta">
                                <div><dt>节点</dt><dd>{request().hookNodeId}</dd></div>
                                <div><dt>设备</dt><dd>{request().deviceId}</dd></div>
                                <div><dt>剩余</dt><dd>{remainingSeconds()} 秒</dd></div>
                            </dl>
                            <Show when={payloadSummary(request().payload)}>
                                {(payload) => (
                                    <details class="surface-confirmation-payload">
                                        <summary>操作参数</summary>
                                        <pre>{payload()}</pre>
                                    </details>
                                )}
                            </Show>
                            <Show when={expired()}>
                                <p class="surface-confirmation-error">确认已过期，请重新发起操作。</p>
                            </Show>
                            <Show when={props.error}>
                                <p class="surface-confirmation-error">{props.error}</p>
                            </Show>
                        </div>

                        <footer class="surface-confirmation-actions">
                            <button
                                ref={rejectButton}
                                type="button"
                                class="surface-confirmation-button surface-confirmation-button--reject"
                                disabled={props.submitting}
                                onClick={() => props.onDecision(false)}
                            >
                                拒绝
                            </button>
                            <button
                                type="button"
                                class="surface-confirmation-button surface-confirmation-button--approve"
                                disabled={props.submitting || expired()}
                                onClick={() => props.onDecision(true)}
                            >
                                {props.submitting ? "提交中" : "确认执行"}
                            </button>
                        </footer>
                    </section>
                </div>
            )}
        </Show>
    );
};
