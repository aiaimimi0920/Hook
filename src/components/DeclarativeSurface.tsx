import {
    Component,
    For,
    Match,
    Show,
    Switch,
    createEffect,
    createSignal,
} from "solid-js";
import type { JSX } from "solid-js";
import {
    SURFACE_PROTOCOL_VERSION,
    SurfaceEvent,
    SurfaceEventClass,
    SurfaceNode,
    SurfaceSnapshot,
} from "../services/surfaceProtocol";
import "./DeclarativeSurface.css";

type SurfaceProps = Record<string, unknown>;

interface Props {
    unitId: string;
    snapshot: SurfaceSnapshot;
    generation: number;
    interactive?: boolean;
    onActivate?: () => void | Promise<void>;
    resolveResource?: (resourceId: string) => string | undefined;
    onEvent: (event: SurfaceEvent) => void;
}

interface NodeProps extends Props {
    node: SurfaceNode;
}

const asRecord = (value: unknown): SurfaceProps =>
    typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as SurfaceProps
        : {};

const stringProp = (props: SurfaceProps, key: string, fallback = ""): string =>
    typeof props[key] === "string" ? props[key] as string : fallback;

const numberProp = (props: SurfaceProps, key: string, fallback = 0): number =>
    typeof props[key] === "number" && Number.isFinite(props[key])
        ? props[key] as number
        : fallback;

const booleanProp = (props: SurfaceProps, key: string, fallback = false): boolean =>
    typeof props[key] === "boolean" ? props[key] as boolean : fallback;

const eventPayload = (values: SurfaceProps): unknown => values.eventPayload ?? {};

const MAX_SURFACE_PIXEL_LENGTH = 8_192;
const MAX_SURFACE_RELATIVE_LENGTH = 1_000;

export const safeSurfaceCssLength = (value: unknown): string | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value >= 0 && value <= MAX_SURFACE_PIXEL_LENGTH ? `${value}px` : undefined;
    }
    if (typeof value !== "string") return undefined;
    const length = value.trim();
    if (length === "auto" || length === "0") return length;
    const match = /^(\d+(?:\.\d+)?)(px|%|rem|em|vw|vh|cqw|cqh|fr)$/.exec(length);
    if (!match) return undefined;
    const magnitude = Number(match[1]);
    if (!Number.isFinite(magnitude)) return undefined;
    const maximum = match[2] === "px" ? MAX_SURFACE_PIXEL_LENGTH : MAX_SURFACE_RELATIVE_LENGTH;
    return magnitude <= maximum ? length : undefined;
};

const SAFE_NAMED_COLORS = new Set([
    "black",
    "white",
    "red",
    "green",
    "blue",
    "gray",
    "grey",
    "yellow",
    "orange",
    "purple",
    "pink",
    "transparent",
    "currentcolor",
]);

export const safeSurfaceCssColor = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const color = value.trim();
    if (color.length === 0 || color.length > 64 || /[;{}!]|url\(|expression\(/i.test(color)) {
        return undefined;
    }
    if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) {
        return color;
    }
    if (/^(?:rgb|rgba|hsl|hsla)\([0-9.,%+\-\s]+\)$/i.test(color)) {
        return color;
    }
    if (/^var\(--[a-z0-9-]{1,48}\)$/i.test(color)) return color;
    return SAFE_NAMED_COLORS.has(color.toLowerCase()) ? color : undefined;
};

const safeAlignment = (value: unknown): JSX.CSSProperties["align-items"] =>
    typeof value === "string" && ["stretch", "flex-start", "center", "flex-end", "baseline"].includes(value)
        ? value as JSX.CSSProperties["align-items"]
        : undefined;

const safeJustification = (value: unknown): JSX.CSSProperties["justify-content"] =>
    typeof value === "string" && [
        "flex-start",
        "center",
        "flex-end",
        "space-between",
        "space-around",
        "space-evenly",
    ].includes(value)
        ? value as JSX.CSSProperties["justify-content"]
        : undefined;

const boundedNumber = (value: unknown, minimum: number, maximum: number): number | undefined =>
    typeof value === "number" && Number.isFinite(value)
        ? Math.min(maximum, Math.max(minimum, value))
        : undefined;

export const surfaceNodeStyle = (node: SurfaceNode): JSX.CSSProperties => {
    const layout = asRecord(node.layout);
    const style = asRecord(node.style);
    const direction = node.type === "row" ? "row" : "column";
    const position = layout.position === "absolute" || layout.position === "relative"
        ? layout.position
        : undefined;
    return {
        display: node.type === "stack" ? "grid" : "flex",
        "flex-direction": direction,
        "align-items": safeAlignment(layout.align) ?? "stretch",
        "justify-content": safeJustification(layout.justify) ?? "flex-start",
        gap: safeSurfaceCssLength(layout.gap),
        padding: safeSurfaceCssLength(layout.padding),
        width: safeSurfaceCssLength(layout.width),
        height: safeSurfaceCssLength(layout.height),
        "min-width": safeSurfaceCssLength(layout.minWidth),
        "min-height": safeSurfaceCssLength(layout.minHeight),
        "max-width": safeSurfaceCssLength(layout.maxWidth),
        "max-height": safeSurfaceCssLength(layout.maxHeight),
        ...(position ? {
            position,
            left: safeSurfaceCssLength(layout.left),
            top: safeSurfaceCssLength(layout.top),
            right: safeSurfaceCssLength(layout.right),
            bottom: safeSurfaceCssLength(layout.bottom),
        } : {}),
        "flex-grow": boundedNumber(layout.grow, 0, 100),
        "overflow-x": layout.overflowX === "auto" || layout.overflowX === "hidden"
            ? layout.overflowX
            : undefined,
        "overflow-y": layout.overflowY === "auto" || layout.overflowY === "hidden"
            ? layout.overflowY
            : undefined,
        color: safeSurfaceCssColor(style.color),
        background: safeSurfaceCssColor(style.background),
        "border-color": safeSurfaceCssColor(style.borderColor),
        "border-width": safeSurfaceCssLength(style.borderWidth),
        "border-style": style.borderWidth === undefined ? undefined : "solid",
        "border-radius": safeSurfaceCssLength(style.borderRadius),
        opacity: boundedNumber(style.opacity, 0, 1),
        "font-size": safeSurfaceCssLength(style.fontSize),
        "line-height": safeSurfaceCssLength(style.lineHeight),
        "font-weight": boundedNumber(style.fontWeight, 100, 900),
        "white-space": typeof style.whiteSpace === "string"
            && ["normal", "nowrap", "pre", "pre-wrap"].includes(style.whiteSpace)
            ? style.whiteSpace as JSX.CSSProperties["white-space"]
            : undefined,
        "text-align": style.textAlign === "left" || style.textAlign === "center" || style.textAlign === "right"
            ? style.textAlign
            : undefined,
        "grid-area": node.type === "stack" ? "1 / 1" : undefined,
    };
};

const newEventId = (): string => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return `event:${crypto.randomUUID()}`;
    }
    return `event:${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const eventClass = (event: string): SurfaceEventClass => {
    if (event === "input" || event === "pointer_move" || event === "scroll") return "continuous";
    if (event === "change" || event === "submit") return "commit";
    return "discrete";
};

const emitNodeEvent = (
    props: NodeProps,
    event: string,
    payload: unknown,
): void => {
    if (props.interactive === false) return;
    const action = props.node.events?.[event];
    if (!action) return;
    props.onEvent({
        protocolVersion: SURFACE_PROTOCOL_VERSION,
        instanceId: props.snapshot.instanceId,
        attachmentId: props.snapshot.attachmentId,
        eventId: newEventId(),
        nodeId: props.node.id,
        event,
        action,
        class: eventClass(event),
        generation: props.generation,
        baseRevision: props.snapshot.revision,
        payload,
    });
};

const accessibleProps = (node: SurfaceNode): Pick<JSX.HTMLAttributes<HTMLElement>, "aria-label" | "aria-description"> => {
    const accessibility = asRecord(node.accessibility);
    return {
        "aria-label": stringProp(accessibility, "label") || undefined,
        "aria-description": stringProp(accessibility, "description") || undefined,
    };
};

const SurfaceChildren: Component<NodeProps> = (props) => (
    <For each={props.node.children ?? []}>
        {(child) => <SurfaceNodeView {...props} node={child} />}
    </For>
);

const SurfaceTextInput: Component<NodeProps & { type: "text" | "number" }> = (props) => {
    const values = () => asRecord(props.node.props);
    const [value, setValue] = createSignal(stringProp(values(), "value"));
    createEffect(() => setValue(stringProp(values(), "value")));
    return (
        <input
            class="surface-control surface-input"
            data-surface-node-id={props.node.id}
            type={props.type}
            value={value()}
            placeholder={stringProp(values(), "placeholder")}
            disabled={booleanProp(values(), "disabled") || props.interactive === false}
            min={props.type === "number" ? numberProp(values(), "min") : undefined}
            max={props.type === "number" ? numberProp(values(), "max") : undefined}
            step={props.type === "number" ? numberProp(values(), "step", 1) : undefined}
            onInput={(event) => {
                setValue(event.currentTarget.value);
                emitNodeEvent(props, "input", {
                    value: props.type === "number"
                        ? event.currentTarget.valueAsNumber
                        : event.currentTarget.value,
                });
            }}
            onChange={(event) => emitNodeEvent(props, "change", {
                value: props.type === "number"
                    ? event.currentTarget.valueAsNumber
                    : event.currentTarget.value,
            })}
            {...accessibleProps(props.node)}
        />
    );
};

const SurfaceNodeView: Component<NodeProps> = (props) => {
    const values = () => asRecord(props.node.props);
    const visible = () => values().visible !== false;
    const resourceSource = () => {
        const resourceId = stringProp(values(), "resourceId");
        if (resourceId) return props.resolveResource?.(resourceId);
        const src = stringProp(values(), "src");
        return /^(data:image\/|blob:)/.test(src) ? src : undefined;
    };

    return (
        <Show when={visible()}>
            <Switch fallback={
                <div class="surface-unsupported" data-surface-node-id={props.node.id}>
                    不支持的控件：{props.node.type}
                </div>
            }>
                <Match when={["view", "row", "column", "stack", "scroll"].includes(props.node.type)}>
                    <div
                        class={`surface-node surface-${props.node.type}`}
                        data-surface-node-id={props.node.id}
                        style={surfaceNodeStyle(props.node)}
                        onClick={() => emitNodeEvent(props, "click", eventPayload(values()))}
                        {...accessibleProps(props.node)}
                    >
                        <SurfaceChildren {...props} />
                    </div>
                </Match>
                <Match when={props.node.type === "text"}>
                    <span
                        class="surface-text"
                        data-surface-node-id={props.node.id}
                        style={surfaceNodeStyle(props.node)}
                        {...accessibleProps(props.node)}
                    >
                        {stringProp(values(), "text")}
                    </span>
                </Match>
                <Match when={props.node.type === "image"}>
                    <Show when={resourceSource()}>
                        {(src) => (
                            <img
                                class="surface-image"
                                data-surface-node-id={props.node.id}
                                src={src()}
                                alt={stringProp(values(), "alt")}
                                draggable={false}
                                style={surfaceNodeStyle(props.node)}
                            />
                        )}
                    </Show>
                </Match>
                <Match when={props.node.type === "icon"}>
                    <span
                        class="surface-icon"
                        data-surface-node-id={props.node.id}
                        aria-hidden={stringProp(asRecord(props.node.accessibility), "label") ? undefined : true}
                        {...accessibleProps(props.node)}
                    >
                        {stringProp(values(), "glyph", "•")}
                    </span>
                </Match>
                <Match when={props.node.type === "button"}>
                    <button
                        class="surface-control surface-button"
                        data-surface-node-id={props.node.id}
                        type="button"
                        disabled={booleanProp(values(), "disabled") || props.interactive === false}
                        onClick={(event) => {
                            event.stopPropagation();
                            emitNodeEvent(props, "click", eventPayload(values()));
                        }}
                        {...accessibleProps(props.node)}
                    >
                        {stringProp(values(), "label")}
                    </button>
                </Match>
                <Match when={props.node.type === "input"}>
                    <SurfaceTextInput {...props} type="text" />
                </Match>
                <Match when={props.node.type === "number"}>
                    <SurfaceTextInput {...props} type="number" />
                </Match>
                <Match when={props.node.type === "textarea"}>
                    <textarea
                        class="surface-control surface-textarea"
                        data-surface-node-id={props.node.id}
                        value={stringProp(values(), "value")}
                        placeholder={stringProp(values(), "placeholder")}
                        disabled={booleanProp(values(), "disabled") || props.interactive === false}
                        onInput={(event) => emitNodeEvent(props, "input", { value: event.currentTarget.value })}
                        onChange={(event) => emitNodeEvent(props, "change", { value: event.currentTarget.value })}
                        {...accessibleProps(props.node)}
                    />
                </Match>
                <Match when={props.node.type === "slider"}>
                    <input
                        class="surface-control surface-slider"
                        data-surface-node-id={props.node.id}
                        type="range"
                        min={numberProp(values(), "min", 0)}
                        max={numberProp(values(), "max", 100)}
                        step={numberProp(values(), "step", 1)}
                        value={numberProp(values(), "value", 0)}
                        disabled={booleanProp(values(), "disabled") || props.interactive === false}
                        onInput={(event) => emitNodeEvent(props, "input", { value: event.currentTarget.valueAsNumber })}
                        onChange={(event) => emitNodeEvent(props, "change", { value: event.currentTarget.valueAsNumber })}
                        {...accessibleProps(props.node)}
                    />
                </Match>
                <Match when={props.node.type === "switch"}>
                    <label class="surface-switch" data-surface-node-id={props.node.id}>
                        <input
                            type="checkbox"
                            checked={booleanProp(values(), "value")}
                            disabled={booleanProp(values(), "disabled") || props.interactive === false}
                            onChange={(event) => emitNodeEvent(props, "change", { value: event.currentTarget.checked })}
                            {...accessibleProps(props.node)}
                        />
                        <span aria-hidden="true" />
                    </label>
                </Match>
                <Match when={props.node.type === "select"}>
                    <select
                        class="surface-control surface-select"
                        data-surface-node-id={props.node.id}
                        value={stringProp(values(), "value")}
                        disabled={booleanProp(values(), "disabled") || props.interactive === false}
                        onChange={(event) => emitNodeEvent(props, "change", { value: event.currentTarget.value })}
                        {...accessibleProps(props.node)}
                    >
                        <For each={Array.isArray(values().options) ? values().options as unknown[] : []}>
                            {(option) => {
                                const item = asRecord(option);
                                return <option value={stringProp(item, "value")}>{stringProp(item, "label")}</option>;
                            }}
                        </For>
                    </select>
                </Match>
                <Match when={props.node.type === "progress"}>
                    <progress
                        class="surface-progress"
                        data-surface-node-id={props.node.id}
                        value={numberProp(values(), "value", 0)}
                        max={numberProp(values(), "max", 1)}
                        {...accessibleProps(props.node)}
                    />
                </Match>
                <Match when={props.node.type === "divider"}>
                    <hr class="surface-divider" data-surface-node-id={props.node.id} />
                </Match>
                <Match when={props.node.type === "spacer"}>
                    <div class="surface-spacer" data-surface-node-id={props.node.id} style={surfaceNodeStyle(props.node)} />
                </Match>
            </Switch>
        </Show>
    );
};

export const DeclarativeSurface: Component<Props> = (props) => (
    <div
        class="declarative-surface"
        data-surface-instance-id={props.snapshot.instanceId}
        data-surface-attachment-id={props.snapshot.attachmentId}
        data-surface-revision={props.snapshot.revision}
        data-surface-unit-id={props.unitId}
        data-overlay-synthetic-target="direct"
        onPointerDown={(event) => {
            if (props.interactive === false) return;
            event.stopPropagation();
            const editable = event.target instanceof Element
                ? event.target.closest<HTMLElement>("input, textarea, select, [contenteditable='true']")
                : null;
            void Promise.resolve(props.onActivate?.()).finally(() => {
                if (!editable?.isConnected) return;
                requestAnimationFrame(() => editable.focus());
            });
        }}
        onMouseDown={(event) => {
            if (props.interactive !== false) event.stopPropagation();
        }}
        onDblClick={(event) => {
            if (props.interactive !== false) event.stopPropagation();
        }}
    >
        <SurfaceNodeView {...props} node={props.snapshot.scene} />
    </div>
);
