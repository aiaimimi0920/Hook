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
                props: { label: "刷新" },
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

    it("rejects malicious and unbounded declarative style values", () => {
        expect(safeSurfaceCssLength("8192px")).toBe("8192px");
        expect(safeSurfaceCssLength("8193px")).toBeUndefined();
        expect(safeSurfaceCssLength("calc(100% + 1px)")).toBeUndefined();
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
    });
});
