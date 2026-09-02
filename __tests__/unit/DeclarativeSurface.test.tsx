// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";

import {
    DeclarativeSurface,
    safeSurfaceCssColor,
    safeSurfaceCssLength,
    surfaceNodeStyle,
} from "../../src/components/DeclarativeSurface";
import {
    SURFACE_PROTOCOL_VERSION,
    type SurfaceEvent,
    type SurfaceSnapshot,
} from "../../src/services/surfaceProtocol";

const snapshot: SurfaceSnapshot = {
    protocolVersion: SURFACE_PROTOCOL_VERSION,
    instanceId: "instance:stock",
    attachmentId: "attachment:desktop",
    artId: "neuro.official/stock-price",
    artVersion: "1.0.0",
    revision: 7,
    scene: {
        id: "root",
        type: "column",
        children: [
            { id: "price", type: "text", props: { text: "¥101.20" } },
            {
                id: "refresh",
                type: "button",
                props: { label: "刷新", eventPayload: { source: "toolbar" } },
                events: { click: "refresh_price" },
            },
            {
                id: "symbol",
                type: "input",
                props: { value: "600519", placeholder: "代码" },
                events: { input: "preview_symbol", change: "commit_symbol" },
            },
        ],
    },
};

describe("DeclarativeSurface", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        vi.restoreAllMocks();
    });

    it("renders host-owned controls and emits typed events with instance context", () => {
        const events: SurfaceEvent[] = [];
        const host = document.createElement("div");
        document.body.append(host);
        const dispose = render(
            () => (
                <DeclarativeSurface
                    unitId="unit:stock"
                    snapshot={snapshot}
                    generation={4}
                    onEvent={(event) => events.push(event)}
                />
            ),
            host,
        );

        expect(host.querySelector("[data-surface-node-id='price']")?.textContent).toBe("¥101.20");
        const button = host.querySelector("button") as HTMLButtonElement;
        button.click();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            protocolVersion: SURFACE_PROTOCOL_VERSION,
            instanceId: "instance:stock",
            attachmentId: "attachment:desktop",
            nodeId: "refresh",
            action: "refresh_price",
            class: "discrete",
            generation: 4,
            baseRevision: 7,
            payload: { source: "toolbar" },
        });
        expect(events[0].eventId).toMatch(/^event:/);
        dispose();
    });

    it("keeps continuous input and committed change as separate event classes", () => {
        const events: SurfaceEvent[] = [];
        const host = document.createElement("div");
        document.body.append(host);
        const dispose = render(
            () => (
                <DeclarativeSurface
                    unitId="unit:stock"
                    snapshot={snapshot}
                    generation={2}
                    onEvent={(event) => events.push(event)}
                />
            ),
            host,
        );
        const input = host.querySelector("input") as HTMLInputElement;
        input.value = "000001";
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));

        expect(events.map((event) => [event.event, event.class])).toEqual([
            ["input", "continuous"],
            ["change", "commit"],
        ]);
        expect(events[0].payload).toEqual({ value: "000001" });
        dispose();
    });

    it("submits the latest bounded textarea draft only when an action opts in", () => {
        const editableSnapshot: SurfaceSnapshot = {
            ...snapshot,
            scene: {
                id: "root",
                type: "column",
                children: [{
                    id: "code-editor",
                    type: "textarea",
                    props: { value: "https://example.com/original", rows: 3, maxLength: 128 },
                }, {
                    id: "copy-edited",
                    type: "button",
                    props: {
                        label: "⧉",
                        includeSurfaceValues: true,
                        eventPayload: { operation: "copy" },
                    },
                    layout: { width: "34px", height: "34px", align: "center", justify: "center" },
                    style: { background: "#d9ff38", borderRadius: "6px" },
                    events: { click: "copy-code" },
                }],
            },
        };
        const events: SurfaceEvent[] = [];
        const host = document.createElement("div");
        document.body.append(host);
        const dispose = render(
            () => (
                <DeclarativeSurface
                    unitId="unit:code"
                    snapshot={editableSnapshot}
                    generation={3}
                    onEvent={(event) => events.push(event)}
                />
            ),
            host,
        );
        const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
        const button = host.querySelector("button") as HTMLButtonElement;
        expect(textarea.rows).toBe(3);
        expect(textarea.maxLength).toBe(128);
        expect(textarea.style.scrollbarGutter).toBe("stable");
        textarea.setSelectionRange(8, 15);
        expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([8, 15]);
        expect(button.style.width).toBe("34px");
        expect(button.style.height).toBe("34px");
        expect(button.style.borderRadius).toBe("6px");
        textarea.value = "https://example.com/edited";
        textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
        button.click();

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            nodeId: "copy-edited",
            action: "copy-code",
            payload: {
                operation: "copy",
                surfaceValues: { "code-editor": "https://example.com/edited" },
            },
        });
        dispose();
    });

    it("keeps popup editing local while outside clicks pass through to host dragging", () => {
        const popupSnapshot: SurfaceSnapshot = {
            ...snapshot,
            scene: {
                id: "root",
                type: "stack",
                children: [{
                    id: "popup-backdrop",
                    type: "stack",
                    props: {
                        hostPointerPassthrough: true,
                        eventPayload: { operation: "dismiss" },
                    },
                    children: [{
                        id: "selectable-backdrop-label",
                        type: "text",
                        props: { text: "select me", selectable: true },
                    }],
                    events: { click: "code-action" },
                }, {
                    id: "popup",
                    type: "column",
                    children: [{
                        id: "code-editor",
                        type: "textarea",
                        props: { value: "editable", rows: 3 },
                    }],
                }],
            },
        };
        const events: SurfaceEvent[] = [];
        const host = document.createElement("div");
        document.body.append(host);
        let hostMouseDowns = 0;
        let hostWheels = 0;
        const activate = vi.fn();
        const dispose = render(
            () => <div onMouseDown={() => {
                hostMouseDowns += 1;
            }} onWheel={() => {
                hostWheels += 1;
            }}>
                <DeclarativeSurface
                    unitId="unit:code"
                    snapshot={popupSnapshot}
                    generation={3}
                    onActivate={activate}
                    onEvent={(event) => events.push(event)}
                />
            </div>,
            host,
        );

        const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
        const backdrop = host.querySelector("[data-surface-node-id='popup-backdrop']") as HTMLElement;
        const selectableLabel = host.querySelector(
            "[data-surface-node-id='selectable-backdrop-label']",
        ) as HTMLElement;
        textarea.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
        textarea.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
        textarea.click();
        expect(events).toHaveLength(0);
        expect(hostMouseDowns).toBe(0);
        expect(activate).not.toHaveBeenCalled();
        expect(textarea.style.userSelect).toBe("text");
        const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 48 });
        textarea.dispatchEvent(wheel);
        expect(hostWheels).toBe(0);
        expect(wheel.defaultPrevented).toBe(false);
        selectableLabel.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
        selectableLabel.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
        expect(hostMouseDowns).toBe(0);
        expect(activate).not.toHaveBeenCalled();
        expect(selectableLabel.style.userSelect).toBe("text");
        backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
        backdrop.click();
        expect(hostMouseDowns).toBe(1);
        expect(events[0]).toMatchObject({
            action: "code-action",
            payload: { operation: "dismiss" },
        });
        dispose();
    });

    it("does not interpret arbitrary HTML or remote image URLs", () => {
        const unsafe: SurfaceSnapshot = {
            ...snapshot,
            scene: {
                id: "root",
                type: "column",
                children: [
                    { id: "markup", type: "text", props: { text: "<img src=x onerror=alert(1)>" } },
                    { id: "remote", type: "image", props: { src: "https://example.invalid/tracker.png" } },
                ],
            },
        };
        const host = document.createElement("div");
        document.body.append(host);
        const dispose = render(
            () => (
                <DeclarativeSurface
                    unitId="unit:unsafe"
                    snapshot={unsafe}
                    generation={0}
                    onEvent={() => undefined}
                />
            ),
            host,
        );

        expect(host.querySelector("[data-surface-node-id='markup']")?.textContent).toContain("<img");
        expect(host.querySelector("img")).toBeNull();
        dispose();
    });

    it("lets a non-interactive compact Surface double-click bubble to the Art node restore handler", () => {
        const host = document.createElement("div");
        document.body.append(host);
        let doubleClicks = 0;
        const dispose = render(
            () => (
                <div onDblClick={() => {
                    doubleClicks += 1;
                }}>
                    <DeclarativeSurface
                        unitId="unit:stock"
                        snapshot={snapshot}
                        generation={4}
                        interactive={false}
                        onEvent={() => undefined}
                    />
                </div>
            ),
            host,
        );

        host.querySelector(".declarative-surface")?.dispatchEvent(
            new MouseEvent("dblclick", { bubbles: true }),
        );

        expect(doubleClicks).toBe(1);
        dispose();
    });

    it("lets blank interactive Surface space bubble to sticker dragging while controls own input", () => {
        const host = document.createElement("div");
        document.body.append(host);
        let hostMouseDowns = 0;
        let hostDoubleClicks = 0;
        const dispose = render(
            () => (
                <div onMouseDown={() => {
                    hostMouseDowns += 1;
                }} onDblClick={() => {
                    hostDoubleClicks += 1;
                }}>
                    <DeclarativeSurface
                        unitId="unit:stock"
                        snapshot={snapshot}
                        generation={4}
                        interactive={true}
                        onEvent={() => undefined}
                    />
                </div>
            ),
            host,
        );

        host.querySelector(".declarative-surface")?.dispatchEvent(
            new MouseEvent("mousedown", { bubbles: true, button: 0 }),
        );
        host.querySelector(".declarative-surface")?.dispatchEvent(
            new MouseEvent("dblclick", { bubbles: true, button: 0 }),
        );
        host.querySelector("button")?.dispatchEvent(
            new MouseEvent("mousedown", { bubbles: true, button: 0 }),
        );
        host.querySelector("button")?.dispatchEvent(
            new MouseEvent("dblclick", { bubbles: true, button: 0 }),
        );

        expect(hostMouseDowns).toBe(1);
        expect(hostDoubleClicks).toBe(1);
        dispose();
    });

    it("keeps declared container actions clickable without starting sticker dragging", () => {
        const interactiveSnapshot: SurfaceSnapshot = {
            ...snapshot,
            scene: {
                id: "overlay-root",
                type: "stack",
                children: [{
                    id: "ocr-block",
                    type: "stack",
                    props: { eventPayload: { text: "single OCR block" } },
                    events: { click: "copy-block" },
                    children: [{
                        id: "ocr-text",
                        type: "text",
                        props: { text: "single OCR block", selectable: true },
                    }],
                }],
            },
        };
        const events: SurfaceEvent[] = [];
        const host = document.createElement("div");
        document.body.append(host);
        let hostMouseDowns = 0;
        const activate = vi.fn();
        const dispose = render(
            () => (
                <div onMouseDown={() => {
                    hostMouseDowns += 1;
                }}>
                    <DeclarativeSurface
                        unitId="unit:ocr"
                        snapshot={interactiveSnapshot}
                        generation={5}
                        interactive={true}
                        onActivate={activate}
                        onEvent={(event) => events.push(event)}
                    />
                </div>
            ),
            host,
        );

        const text = host.querySelector("[data-surface-node-id='ocr-text']") as HTMLElement;
        const selection = window.getSelection() as Selection;
        const range = document.createRange();
        range.setStart(text.firstChild as Text, 0);
        range.setEnd(text.firstChild as Text, 6);
        selection.removeAllRanges();
        selection.addRange(range);
        text.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
        text.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
        text.click();

        expect(hostMouseDowns).toBe(0);
        expect(activate).not.toHaveBeenCalled();
        expect(text.dataset.surfaceSelectableText).toBe("true");
        expect(text.style.userSelect).toBe("text");
        expect(events).toHaveLength(0);

        selection.removeAllRanges();
        text.click();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            nodeId: "ocr-block",
            action: "copy-block",
            payload: { text: "single OCR block" },
        });
        dispose();
    });

    it("rejects malicious and unbounded declarative style values", () => {
        expect(safeSurfaceCssLength("8192px")).toBe("8192px");
        expect(safeSurfaceCssLength("2.75cqh")).toBe("2.75cqh");
        expect(safeSurfaceCssLength("min(2.75cqh, 3.5cqw)")).toBe("min(2.75cqh, 3.5cqw)");
        expect(safeSurfaceCssLength("min(17.50000%, calc(100% - min(45%, 280px)))"))
            .toBe("min(17.50000%, calc(100% - min(45%, 280px)))");
        expect(safeSurfaceCssLength("min(calc(17.50000% + 30px), calc(100% - min(45%, 280px)))"))
            .toBe("min(calc(17.50000% + 30px), calc(100% - min(45%, 280px)))");
        expect(safeSurfaceCssLength("8193px")).toBeUndefined();
        expect(safeSurfaceCssLength("calc(100% + 1px)")).toBeUndefined();
        expect(safeSurfaceCssLength("min(17%, calc(100% - min(45%, 280px)));left:0"))
            .toBeUndefined();
        expect(safeSurfaceCssLength("min(calc(17% + 30px);left:0, calc(100% - min(45%, 280px)))"))
            .toBeUndefined();
        expect(safeSurfaceCssLength("min(2cqh, 3cqw);position:fixed")).toBeUndefined();
        expect(safeSurfaceCssLength(-1)).toBeUndefined();
        expect(safeSurfaceCssColor("var(--surface-text)")).toBe("var(--surface-text)");
        expect(safeSurfaceCssColor("url(https://example.invalid/tracker.png)")).toBeUndefined();
        expect(safeSurfaceCssColor("red !important")).toBeUndefined();

        const style = surfaceNodeStyle({
            id: "malicious-style",
            type: "column",
            layout: {
                align: "position:fixed",
                justify: "url(javascript:alert(1))",
                width: "999999999px",
                grow: Number.POSITIVE_INFINITY,
            },
            style: {
                background: "red;position:fixed",
                color: "expression(alert(1))",
                fontWeight: Number.POSITIVE_INFINITY,
                opacity: Number.NaN,
                position: "fixed",
                zIndex: 2147483647,
            },
        });

        expect(style["align-items"]).toBe("stretch");
        expect(style["justify-content"]).toBe("flex-start");
        expect(style.width).toBeUndefined();
        expect(style["flex-grow"]).toBeUndefined();
        expect(style.background).toBeUndefined();
        expect(style.color).toBeUndefined();
        expect(style["font-weight"]).toBeUndefined();
        expect(style.opacity).toBeUndefined();
        expect(style).not.toHaveProperty("position");
        expect(style).not.toHaveProperty("z-index");

        expect(surfaceNodeStyle({
            id: "bounded-position",
            type: "text",
            layout: { position: "absolute", left: 4, top: "10%", width: 80 },
        })).toMatchObject({ position: "absolute", left: "4px", top: "10%", width: "80px" });
        expect(surfaceNodeStyle({
            id: "container-scaled-text",
            type: "text",
            style: {
                fontSize: "min(2.75cqh, 3.5cqw)",
                lineHeight: "3cqh",
                whiteSpace: "nowrap",
            },
        })).toMatchObject({
            "font-size": "min(2.75cqh, 3.5cqw)",
            "line-height": "3cqh",
            "white-space": "nowrap",
        });
    });
});
