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
import {
    safeSurfaceCssColor,
    safeSurfaceCssLength,
    surfaceNodeStyle,
} from "./declarativeSurfaceStyle";
import "./DeclarativeSurface.css";

export { safeSurfaceCssColor, safeSurfaceCssLength, surfaceNodeStyle };

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
    surfaceValues: () => Readonly<Record<string, string>>;
    updateSurfaceValue: (nodeId: string, value: string) => void;
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

const eventPayload = (
    values: SurfaceProps,
    surfaceValues: Readonly<Record<string, string>>,
): unknown => {
    const configured = values.eventPayload ?? {};
    if (!booleanProp(values, "includeSurfaceValues") || Object.keys(surfaceValues).length === 0) {
        return configured;
    }
    return typeof configured === "object" && configured !== null && !Array.isArray(configured)
        ? { ...configured as SurfaceProps, surfaceValues }
        : { configured, surfaceValues };
};
const MAX_SURFACE_DRAFT_FIELDS = 16;
const MAX_SURFACE_DRAFT_CHARACTERS = 64 * 1024;
const MAX_SURFACE_DRAFT_VALUE_BYTES = 48 * 1024;
const MAX_SURFACE_DRAFT_TOTAL_BYTES = 48 * 1024;
const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength;
const truncateUtf8 = (value: string, maximumBytes: number): string => {
    if (utf8Bytes(value) <= maximumBytes) return value;
    let low = 0;
    let high = value.length;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (utf8Bytes(value.slice(0, middle)) <= maximumBytes) low = middle;
        else high = middle - 1;
    }
    return value.slice(0, low);
};
const SURFACE_POINTER_OWNER_SELECTOR = [
    "[data-surface-pointer-owner='true']",
    "[data-surface-selectable-text='true']",
    "button",
    "input",
    "textarea",
    "select",
    "label",
    "[contenteditable='true']",
].join(",");

const ownsSurfacePointerInteraction = (target: EventTarget | null): boolean =>
    target instanceof Element && target.closest(SURFACE_POINTER_OWNER_SELECTOR) !== null;

const ownsSelectableTextInteraction = (target: EventTarget | null): boolean =>
    target instanceof Element
    && target.closest("[data-surface-selectable-text='true']") !== null;

const hasSelectableTextSelection = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    const selectable = target.closest<HTMLElement>("[data-surface-selectable-text='true']");
    const selection = selectable?.ownerDocument.defaultView?.getSelection();
    if (!selectable || !selection || selection.isCollapsed || !selection.toString()) return false;
    return selectable.contains(selection.anchorNode) || selectable.contains(selection.focusNode);
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
    createEffect(() => {
        const next = stringProp(values(), "value");
        setValue(next);
        props.updateSurfaceValue(props.node.id, next);
    });
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
                props.updateSurfaceValue(props.node.id, event.currentTarget.value);
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
                        data-surface-pointer-owner={Object.values(props.node.events ?? {}).some(Boolean)
                            && !booleanProp(values(), "hostPointerPassthrough")
                            ? "true"
                            : undefined}
                        style={surfaceNodeStyle(props.node)}
                        onClick={(event) => {
                            // A native selection gesture must not turn into the
                            // container's whole-block click action on pointer-up.
                            if (hasSelectableTextSelection(event.target)) {
                                event.stopPropagation();
                                return;
                            }
                            emitNodeEvent(
                                props,
                                "click",
                                eventPayload(values(), props.surfaceValues()),
                            );
                        }}
                        {...accessibleProps(props.node)}
                    >
                        <SurfaceChildren {...props} />
                    </div>
                </Match>
                <Match when={props.node.type === "text"}>
                    <span
                        class="surface-text"
                        data-surface-node-id={props.node.id}
                        data-surface-selectable-text={booleanProp(values(), "selectable") ? "true" : undefined}
                        style={{
                            ...surfaceNodeStyle(props.node),
                            ...(booleanProp(values(), "selectable") ? {
                                "user-select": "text",
                                "-webkit-user-select": "text",
                            } : {}),
                        }}
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
                        style={surfaceNodeStyle(props.node)}
                        onClick={(event) => {
                            event.stopPropagation();
                            emitNodeEvent(
                                props,
                                "click",
                                eventPayload(values(), props.surfaceValues()),
                            );
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
                    <SurfaceTextArea {...props} />
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

const SurfaceTextArea: Component<NodeProps> = (props) => {
    const values = () => asRecord(props.node.props);
    const [value, setValue] = createSignal(stringProp(values(), "value"));
    createEffect(() => {
        const next = stringProp(values(), "value");
        setValue(next);
        props.updateSurfaceValue(props.node.id, next);
    });
    const rows = () => Math.trunc(Math.min(20, Math.max(1, numberProp(values(), "rows", 3))));
    const maxLength = () => Math.trunc(Math.min(
        MAX_SURFACE_DRAFT_CHARACTERS,
        Math.max(1, numberProp(values(), "maxLength", MAX_SURFACE_DRAFT_CHARACTERS)),
    ));
    return (
        <textarea
            class="surface-control surface-textarea"
            data-surface-node-id={props.node.id}
            data-surface-selectable-text="true"
            value={value()}
            rows={rows()}
            maxLength={maxLength()}
            placeholder={stringProp(values(), "placeholder")}
            disabled={booleanProp(values(), "disabled") || props.interactive === false}
            style={{
                ...surfaceNodeStyle(props.node),
                "user-select": "text",
                "-webkit-user-select": "text",
                "scrollbar-gutter": "stable",
            }}
            onInput={(event) => {
                const next = event.currentTarget.value;
                setValue(next);
                props.updateSurfaceValue(props.node.id, next);
                emitNodeEvent(props, "input", { value: next });
            }}
            onChange={(event) => emitNodeEvent(props, "change", { value: event.currentTarget.value })}
            onWheel={(event) => event.stopPropagation()}
            {...accessibleProps(props.node)}
        />
    );
};

export const DeclarativeSurface: Component<Props> = (props) => {
    const [surfaceValues, setSurfaceValues] = createSignal<Record<string, string>>({});
    const updateSurfaceValue = (nodeId: string, value: string): void => {
        setSurfaceValues((current) => {
            if (!Object.prototype.hasOwnProperty.call(current, nodeId)
                && Object.keys(current).length >= MAX_SURFACE_DRAFT_FIELDS) return current;
            const otherBytes = Object.entries(current).reduce((total, [key, existing]) =>
                key === nodeId ? total : total + utf8Bytes(existing), 0);
            const availableBytes = Math.max(0, MAX_SURFACE_DRAFT_TOTAL_BYTES - otherBytes);
            const bounded = truncateUtf8(
                value.slice(0, MAX_SURFACE_DRAFT_CHARACTERS),
                Math.min(MAX_SURFACE_DRAFT_VALUE_BYTES, availableBytes),
            );
            return current[nodeId] === bounded ? current : { ...current, [nodeId]: bounded };
        });
    };
    return <div
        class="declarative-surface"
        data-surface-instance-id={props.snapshot.instanceId}
        data-surface-attachment-id={props.snapshot.attachmentId}
        data-surface-revision={props.snapshot.revision}
        data-surface-unit-id={props.unitId}
        data-overlay-synthetic-target="direct"
        onPointerDown={(event) => {
            // Blank Surface space remains part of the unit drag target. Only
            // host-rendered controls and declared actions claim pointer input.
            if (props.interactive === false || !ownsSurfacePointerInteraction(event.target)) return;
            event.stopPropagation();
            // Refocusing the native overlay window while the browser is
            // establishing a selection cancels text drag selection in WebView2.
            if (ownsSelectableTextInteraction(event.target)) return;
            const editable = event.target instanceof Element
                ? event.target.closest<HTMLElement>("input, textarea, select, [contenteditable='true']")
                : null;
            void Promise.resolve(props.onActivate?.()).finally(() => {
                if (!editable?.isConnected) return;
                requestAnimationFrame(() => editable.focus());
            });
        }}
        onMouseDown={(event) => {
            if (props.interactive !== false && ownsSurfacePointerInteraction(event.target)) {
                event.stopPropagation();
            }
        }}
        onDblClick={(event) => {
            if (props.interactive !== false && ownsSurfacePointerInteraction(event.target)) {
                event.stopPropagation();
            }
        }}
    >
        <SurfaceNodeView
            {...props}
            node={props.snapshot.scene}
            surfaceValues={surfaceValues}
            updateSurfaceValue={updateSurfaceValue}
        />
    </div>
};
