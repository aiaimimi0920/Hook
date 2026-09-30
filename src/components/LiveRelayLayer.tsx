import { createEffect, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js";

import { clampLiveViewGeometry } from "../services/liveCapture";
import type { LiveCaptureInputPayload } from "../services/liveCapture";
import {
    liveMouseButton,
    liveNormalizedPoint,
    liveVirtualKey,
    liveWheelPayload,
} from "../services/liveCaptureInput";
import type { LiveRelayController } from "../services/liveRelayController";
import type { LiveRelayObservation, LiveRelayTriggerAudit } from "../services/liveRelay";
import { liveRelayActions, liveRelayViews } from "../store/liveRelayStore";
import { addOrUpdateRect, removeRect } from "../services/uiRegistry";
import { syncService } from "../services/syncService";
import "./LiveCaptureLayer.css";

type DragState = {
    kind: "move" | "resize";
    startX: number;
    startY: number;
    x: number;
    y: number;
    width: number;
    height: number;
};

const relayStateLabel = (state: string): string => ({
    connecting: "正在连接",
    connected: "远端实时",
    recovering: "正在恢复",
    closed: "已关闭",
}[state] ?? "未知");

const observationStateLabel = (state: string): string => ({
    unsupported: "语义不可用",
    observing: "正在确认",
    stable: "精确稳定",
    stale: "控件已失效",
    error: "读取失败",
    closed: "观察已关闭",
}[state] ?? "语义未知");

const triggerOutcomeLabel = (audit: LiveRelayTriggerAudit): string => ({
    fired: "已触发",
    skipped: "已跳过",
    failed: "触发失败",
}[audit.outcome]);

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;

const finiteNumber = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;

const trustedObservation = (observation: LiveRelayObservation): boolean =>
    ["detected", "observing", "stable", "triggered"].includes(observation.state)
    && observation.confidence === "exact"
    && observation.value !== undefined
    && observation.value !== null;

const observationTitle = (observation: LiveRelayObservation): string =>
    observation.locator?.name
    ?? observation.locator?.automationId
    ?? observation.locator?.controlType
    ?? "未命名控件";

const observationValueLabel = (observation: LiveRelayObservation): string => {
    if (!trustedObservation(observation)) return observation.reason ?? "没有可信值";
    const value = asRecord(observation.value);
    const range = asRecord(value?.rangeValue);
    const current = finiteNumber(range?.value);
    const maximum = finiteNumber(range?.maximum);
    if (current !== undefined) return maximum === undefined ? `${current}` : `${current} / ${maximum}`;
    const semanticValue = asRecord(value?.value);
    if (typeof semanticValue?.text === "string") return semanticValue.text.slice(0, 80) || "空文本";
    if (typeof value?.text === "string") return value.text.slice(0, 80) || "空文本";
    if (typeof value?.toggleState === "string") return `开关：${value.toggleState}`;
    if (typeof value?.title === "string") return value.title.slice(0, 80);
    return "精确状态已更新";
};

type ObservationAnchor = { x: number; y: number; width: number; height: number };

const observationAnchor = (observation: LiveRelayObservation): ObservationAnchor | undefined => {
    if (!trustedObservation(observation) || observation.locator?.controlType === "Window") return undefined;
    const anchor = asRecord(asRecord(observation.value)?.anchor);
    const bounds = asRecord(anchor?.normalizedBounds);
    const x = finiteNumber(bounds?.x);
    const y = finiteNumber(bounds?.y);
    const width = finiteNumber(bounds?.width);
    const height = finiteNumber(bounds?.height);
    if (x === undefined || y === undefined || width === undefined || height === undefined
        || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.01 || y + height > 1.01) {
        return undefined;
    }
    return { x, y, width, height };
};

const LiveRelayWindow: Component<{ view: typeof liveRelayViews[number]; controller: LiveRelayController }> = (props) => {
    const [pending, setPending] = createSignal(false);
    const pressedButtons = new Set<"left" | "right" | "middle">();
    const pressedKeys = new Set<number>();
    let lastPoint = { normalizedX: 0.5, normalizedY: 0.5 };
    let drag: DragState | undefined;
    const rectId = () => `live-relay-${props.view.relayId}`;
    const interactive = () => props.view.status.controllerOwned
        && props.view.status.connectionState === "connected";
    const trustedObservations = () => props.view.status.observations.filter(trustedObservation);

    const beginDrag = (kind: DragState["kind"], event: MouseEvent) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        liveRelayActions.bringToFront(props.view.relayId);
        drag = {
            kind,
            startX: event.clientX,
            startY: event.clientY,
            x: props.view.x,
            y: props.view.y,
            width: props.view.width,
            height: props.view.height,
        };
    };

    const moveDrag = (event: MouseEvent) => {
        if (!drag) return;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        const next = drag.kind === "move"
            ? { ...drag, x: drag.x + dx, y: drag.y + dy }
            : { ...drag, width: drag.width + dx, height: drag.height + dy };
        liveRelayActions.updateGeometry(
            props.view.relayId,
            clampLiveViewGeometry(next, { width: window.innerWidth, height: window.innerHeight }),
        );
    };
    const endDrag = () => { drag = undefined; };

    const send = (input: LiveCaptureInputPayload): Promise<void> =>
        props.controller.sendInput(props.view.relayId, input).catch(() => undefined);

    const releasePressed = async (): Promise<void> => {
        const inputs: LiveCaptureInputPayload[] = [
            ...[...pressedButtons].map((button): LiveCaptureInputPayload => ({
                kind: "mouse_button_up",
                button,
                ...lastPoint,
            })),
            ...[...pressedKeys].map((virtualKey): LiveCaptureInputPayload => ({
                kind: "key_up",
                virtualKey,
            })),
        ];
        pressedButtons.clear();
        pressedKeys.clear();
        for (const input of inputs) await send(input);
    };

    const pointFor = (event: PointerEvent | WheelEvent, clampOutside = false) => {
        const point = liveNormalizedPoint(
            (event.currentTarget as HTMLDivElement).getBoundingClientRect(),
            { width: props.view.frameWidth, height: props.view.frameHeight },
            event.clientX,
            event.clientY,
            clampOutside,
        );
        if (point) lastPoint = point;
        return point;
    };

    const changeControl = async () => {
        if (pending()) return;
        setPending(true);
        try {
            if (props.view.status.controllerOwned) await releasePressed();
            await props.controller.changeController(
                props.view.relayId,
                !props.view.status.controllerOwned,
            );
        } finally {
            setPending(false);
        }
    };

    const close = async () => {
        if (pending()) return;
        setPending(true);
        try {
            await releasePressed();
            await props.controller.stop(props.view.relayId);
        } finally {
            setPending(false);
        }
    };

    onMount(() => {
        window.addEventListener("mousemove", moveDrag);
        window.addEventListener("mouseup", endDrag);
        window.addEventListener("blur", releasePressed);
    });
    onCleanup(() => {
        void releasePressed();
        window.removeEventListener("mousemove", moveDrag);
        window.removeEventListener("mouseup", endDrag);
        window.removeEventListener("blur", releasePressed);
        removeRect(rectId());
        void syncService.updateBackendRects();
    });
    createEffect(() => {
        addOrUpdateRect({
            id: rectId(),
            name: rectId(),
            x: props.view.x,
            y: props.view.y,
            width: props.view.width,
            height: props.view.height,
        });
        void syncService.updateBackendRects();
    });
    createEffect(() => {
        if (!interactive()) {
            pressedButtons.clear();
            pressedKeys.clear();
        }
    });

    return (
        <section
            class={`hook-live-window hook-live-window--${props.view.status.connectionState}`}
            aria-label={`远端实时画面：${props.view.title}`}
            data-overlay-synthetic-target="direct"
            style={{
                left: `${props.view.x}px`,
                top: `${props.view.y}px`,
                width: `${props.view.width}px`,
                height: `${props.view.height}px`,
                "z-index": props.view.pinned ? props.view.zIndex + 10_000_000 : props.view.zIndex,
            }}
            onMouseDown={() => liveRelayActions.bringToFront(props.view.relayId)}
        >
            <header class="hook-live-window__header" onMouseDown={(event) => beginDrag("move", event)}>
                <span class="hook-live-window__signal" aria-hidden="true" />
                <div class="hook-live-window__identity">
                    <strong>{props.view.title}</strong>
                    <span>{props.view.frameWidth}×{props.view.frameHeight} · {props.view.status.receivedFrames} 帧</span>
                </div>
                <span class="hook-live-window__state">{relayStateLabel(props.view.status.connectionState)}</span>
                <button
                    type="button"
                    class={`hook-terminal-btn hook-live-window__button ${props.view.pinned ? "hook-terminal-btn--active" : ""}`}
                    aria-pressed={props.view.pinned}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={() => liveRelayActions.setPinned(props.view.relayId, !props.view.pinned)}
                >
                    {props.view.pinned ? "已置顶" : "置顶"}
                </button>
                <button
                    type="button"
                    class="hook-terminal-btn hook-terminal-btn--danger hook-live-window__button"
                    disabled={pending()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={() => void close()}
                >关闭</button>
            </header>
            <div
                class={`hook-live-window__viewport ${interactive() ? "hook-live-window__viewport--interactive" : ""}`}
                tabIndex={interactive() ? 0 : -1}
                data-hook-global-shortcuts={interactive() ? "ignore" : undefined}
                onContextMenu={(event) => { if (interactive()) event.preventDefault(); }}
                onPointerMove={(event) => {
                    if (!interactive()) return;
                    const point = pointFor(event, pressedButtons.size > 0);
                    if (point) {
                        event.preventDefault();
                        event.stopPropagation();
                        void send({ kind: "mouse_move", ...point });
                    }
                }}
                onPointerDown={(event) => {
                    if (!interactive()) return;
                    const button = liveMouseButton(event.button);
                    const point = pointFor(event);
                    if (!button || !point) return;
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.focus({ preventScroll: true });
                    event.currentTarget.setPointerCapture(event.pointerId);
                    pressedButtons.add(button);
                    void send({ kind: "mouse_button_down", button, clickCount: event.detail >= 2 ? 2 : 1, ...point });
                }}
                onPointerUp={(event) => {
                    const button = liveMouseButton(event.button);
                    if (!interactive() || !button || !pressedButtons.has(button)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    pressedButtons.delete(button);
                    void send({ kind: "mouse_button_up", button, ...(pointFor(event, true) ?? lastPoint) });
                }}
                onPointerCancel={() => void releasePressed()}
                onWheel={(event) => {
                    if (!interactive()) return;
                    const wheel = liveWheelPayload(event);
                    const point = pointFor(event);
                    if (wheel.wheelDelta && point) {
                        event.preventDefault();
                        event.stopPropagation();
                        void send({ kind: "mouse_wheel", ...wheel, ...point });
                    }
                }}
                onKeyDown={(event) => {
                    const virtualKey = interactive() && !event.repeat ? liveVirtualKey(event) : undefined;
                    if (!virtualKey) return;
                    event.preventDefault();
                    event.stopPropagation();
                    pressedKeys.add(virtualKey);
                    void send({ kind: "key_down", virtualKey });
                }}
                onKeyUp={(event) => {
                    const virtualKey = interactive() ? liveVirtualKey(event) : undefined;
                    if (!virtualKey || !pressedKeys.delete(virtualKey)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    void send({ kind: "key_up", virtualKey });
                }}
            >
                <div class="hook-live-window__controls" onPointerDown={(event) => event.stopPropagation()}>
                    <button
                        type="button"
                        class={`hook-terminal-btn ${interactive() ? "hook-terminal-btn--active" : ""}`}
                        disabled={pending() || props.view.status.connectionState !== "connected"}
                        aria-pressed={props.view.status.controllerOwned}
                        onClick={() => void changeControl()}
                    >
                        {props.view.status.controllerOwned ? "终止远程控制" : "请求控制"}
                    </button>
                </div>
                <For each={trustedObservations()}>
                    {(observation) => {
                        const anchor = () => observationAnchor(observation);
                        return (
                            <Show when={anchor()}>
                                {(bounds) => (
                                    <span
                                        class="hook-live-window__semantic-anchor"
                                        aria-hidden="true"
                                        title={observationTitle(observation)}
                                        style={{
                                            left: `${bounds().x * 100}%`,
                                            top: `${bounds().y * 100}%`,
                                            width: `${bounds().width * 100}%`,
                                            height: `${bounds().height * 100}%`,
                                        }}
                                    />
                                )}
                            </Show>
                        );
                    }}
                </For>
                <aside
                    class={`hook-live-window__observations hook-live-window__observations--${props.view.status.observationState}`}
                    aria-live="polite"
                >
                    <header>
                        <strong>UIA · {observationStateLabel(props.view.status.observationState)}</strong>
                        <span>
                            {props.view.status.observationCapabilities.length} 能力
                            / {props.view.status.observations.length} 控件
                            / {props.view.status.triggers.length} 触发器
                        </span>
                    </header>
                    <Show
                        when={props.view.status.observations.length > 0}
                        fallback={<p>{props.view.status.observationReason ?? "等待可识别控件"}</p>}
                    >
                        <For each={props.view.status.observations.slice(0, 5)}>
                            {(observation) => (
                                <div class={`hook-live-window__observation hook-live-window__observation--${observation.state}`}>
                                    <span>{observation.locator?.controlType ?? "Unknown"}</span>
                                    <strong>{observationTitle(observation)}</strong>
                                    <small>{observationValueLabel(observation)}</small>
                                </div>
                            )}
                        </For>
                    </Show>
                    <For each={[...props.view.status.triggerAudits].slice(-3).reverse()}>
                        {(audit) => (
                            <div class={`hook-live-window__observation hook-live-window__observation--${audit.outcome}`}>
                                <span>{triggerOutcomeLabel(audit)}</span>
                                <strong>{audit.bindingId}</strong>
                                <small>
                                    {audit.reason ?? `${audit.observationId} #${audit.observationSequence}`}
                                </small>
                            </div>
                        )}
                    </For>
                </aside>
                <Show when={props.view.imageUrl} fallback={<div class="hook-live-window__empty">等待远端画面</div>}>
                    {(url) => <img src={url()} alt="远端源窗口实时画面" draggable={false} />}
                </Show>
                <Show when={props.view.controlError ?? props.view.status.errorMessage}>
                    {(message) => <div class="hook-live-window__error" role="alert">{message()}</div>}
                </Show>
            </div>
            <button
                type="button"
                class="hook-live-window__resize"
                aria-label="调整远端实时画面大小"
                onMouseDown={(event) => beginDrag("resize", event)}
            />
        </section>
    );
};

export const LiveRelayLayer: Component<{ controller: LiveRelayController }> = (props) => (
    <For each={liveRelayViews.filter((view) => view.status.role === "viewer")}>
        {(view) => <LiveRelayWindow view={view} controller={props.controller} />}
    </For>
);
