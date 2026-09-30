import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { api } from "../services/api";
import { decideDelivery } from "../services/projectionDeliveryReceiver";
import type { DeliveryInvitation } from "../services/projectionDeliveryApi";
import { projectionError } from "../services/qrProjectionProtocol";
import { acceptsSurfaceRelayedKeydown } from "../services/surfaceHostKeydown";
import { syncService } from "../services/syncService";
import { addOrUpdateRect, removeRect } from "../services/uiRegistry";
import { deliveryBusy, deliveryError, deliveryPending, deliverySettings } from "../store/projectionDeliveryStore";
import { projectionDialog } from "../store/qrProjectionStore";
import "./ProjectionDeliveryPrompt.css";

const invitationKey = (item: DeliveryInvitation) => JSON.stringify([
    item.offlineTransport?.origin ?? item.envelope.serverOrigin,
    item.envelope.serverOrigin, item.envelope.projectionId,
]);

/** The inbox owns invitations; this view only remembers temporary dismissals. */
export const ProjectionDeliveryPrompt = () => {
    const [dismissed, setDismissed] = createSignal<ReadonlySet<string>>(new Set());
    createEffect(() => {
        deliverySettings();
        setDismissed(new Set<string>());
    });
    createEffect(() => {
        const live = new Set(deliveryPending().map(invitationKey));
        setDismissed((previous) => {
            const retained = new Set([...previous].filter((key) => live.has(key)));
            return retained.size === previous.size ? previous : retained;
        });
    });
    const candidates = createMemo(() => deliverySettings().policy !== "confirm" ? [] : deliveryPending()
        .filter((item) => !item.accepted && !dismissed().has(invitationKey(item))));
    const current = createMemo(() => candidates()[0]);
    return <Show when={!projectionDialog() && current() && invitationKey(current()!)} keyed>{(key) =>
        <DeliveryPromptCard invitation={current()!} count={candidates().length}
            dismiss={() => setDismissed((previous) => new Set([...previous, key]))} />
    }</Show>;
};

const DeliveryPromptCard = (props: { invitation: DeliveryInvitation; count: number; dismiss: () => void }) => {
    let panel: HTMLElement | undefined;
    let previousFocus: HTMLElement | null = null;
    const rectId = "projection-delivery-prompt";
    // A native synthetic pointer session can retain a detached button until mouseup.
    const decide = (accept: boolean) => {
        if (panel?.isConnected && !deliveryBusy()) void decideDelivery(props.invitation, accept);
    };
    const dismiss = () => {
        if (panel?.isConnected && !deliveryBusy()) props.dismiss();
    };
    const focus = (event: PointerEvent | MouseEvent) => {
        event.stopPropagation();
        void api.focusOverlayWindow().catch(() => undefined);
    };
    onMount(() => {
        previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const updateRect = () => {
            const rect = panel?.getBoundingClientRect();
            if (!rect) return;
            addOrUpdateRect({ id: rectId, name: "PROJECTION_DELIVERY_PROMPT",
                x: rect.x, y: rect.y, width: rect.width, height: rect.height });
            void syncService.updateBackendRects().catch(() => undefined);
        };
        // The native click-through layer needs the actual panel, not its transparent host.
        const observer = new ResizeObserver(updateRect);
        if (panel) observer.observe(panel);
        window.addEventListener("resize", updateRect);
        updateRect();
        onCleanup(() => {
            const ownedFocus = panel?.contains(document.activeElement);
            observer.disconnect();
            window.removeEventListener("resize", updateRect);
            removeRect(rectId);
            void syncService.updateBackendRects().catch(() => undefined);
            if (ownedFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        });
    });
    return <Portal><div class="projection-delivery-prompt-host">
        <section ref={panel} class="projection-delivery-prompt" role="dialog" aria-modal="false"
            aria-label="接收投射确认" aria-busy={deliveryBusy()} data-overlay-synthetic-target="direct"
            on:pointerdown={focus} on:mousedown={focus} on:mouseup={(event) => event.stopPropagation()}
            on:click={(event) => event.stopPropagation()} on:wheel={(event) => event.stopPropagation()}
            on:keydown={(event) => {
                if (!acceptsSurfaceRelayedKeydown(event)) return;
                event.stopPropagation();
                if (event.key === "Escape" && !deliveryBusy()) { event.preventDefault(); dismiss(); }
            }}>
            <header><strong>收到投射</strong><span aria-label="待处理数量">{props.count}</span>
                <button type="button" class="hook-terminal-btn" aria-label="稍后处理投射" title="稍后处理"
                    disabled={deliveryBusy()} on:click={dismiss}>×</button></header>
            <p aria-live="polite"><b>{props.invitation.sourceName}</b> 请求投送{props.invitation.envelope.content.kind === "art" ? " Art 图像" : "贴图"}并持续同步。</p>
            <div class="projection-delivery-prompt-actions">
                <button type="button" class="hook-terminal-btn hook-terminal-btn--active" disabled={deliveryBusy()}
                    on:click={() => decide(true)}>接收并显示</button>
                <button type="button" class="hook-terminal-btn" disabled={deliveryBusy()}
                    on:click={() => decide(false)}>拒绝</button>
            </div>
            <Show when={deliveryError()}><p role="alert">{projectionError(deliveryError())}</p></Show>
        </section>
    </div></Portal>;
};
