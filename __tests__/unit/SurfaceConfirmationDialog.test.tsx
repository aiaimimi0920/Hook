// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { render } from "solid-js/web";

import { SurfaceConfirmationDialog } from "../../src/components/SurfaceConfirmationDialog";
import {
    SURFACE_PROTOCOL_VERSION,
    type SurfaceConfirmationRequest,
} from "../../src/services/surfaceProtocol";

const request = (): SurfaceConfirmationRequest => ({
    protocolVersion: SURFACE_PROTOCOL_VERSION,
    confirmationId: "confirmation:one",
    instanceId: "instance:one",
    attachmentId: "attachment:one",
    deviceId: "device-000-local",
    hookNodeId: "hook-node:one",
    eventId: "event:one",
    requestId: "request:one",
    actionId: "submit_order",
    risk: "high",
    expiresAtMs: Date.now() + 60_000,
    payload: { markup: "<img src=x onerror=alert(1)>" },
});

describe("SurfaceConfirmationDialog", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("renders Host-owned high-risk chrome and requires an explicit decision", () => {
        const decisions: boolean[] = [];
        const host = document.createElement("div");
        document.body.append(host);
        const dispose = render(
            () => (
                <SurfaceConfirmationDialog
                    request={request()}
                    onDecision={(approved) => decisions.push(approved)}
                />
            ),
            host,
        );

        expect(host.querySelector("[role='alertdialog']")).not.toBeNull();
        expect(host.textContent).toContain("submit_order");
        expect(host.textContent).toContain("高风险");
        expect(host.querySelector("img")).toBeNull();
        const buttons = [...host.querySelectorAll("button")];
        buttons.find((button) => button.textContent === "确认执行")?.click();
        expect(decisions).toEqual([true]);
        dispose();
    });

    it("treats Escape as a safe rejection", () => {
        const decisions: boolean[] = [];
        const host = document.createElement("div");
        document.body.append(host);
        const dispose = render(
            () => (
                <SurfaceConfirmationDialog
                    request={request()}
                    onDecision={(approved) => decisions.push(approved)}
                />
            ),
            host,
        );
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(decisions).toEqual([false]);
        dispose();
    });
});
