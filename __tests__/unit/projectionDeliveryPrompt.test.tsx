import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { ProjectionDeliveryPrompt } from "../../src/components/ProjectionDeliveryPrompt";
import { api } from "../../src/services/api";
import { decideDelivery } from "../../src/services/projectionDeliveryReceiver";
import type { DeliveryInvitation } from "../../src/services/projectionDeliveryApi";
import { syncService } from "../../src/services/syncService";
import { extraRects } from "../../src/services/uiRegistry";
import { deliveryPending, saveDeliverySettings, setDeliveryBusy, setDeliveryError, setDeliveryPending } from "../../src/store/projectionDeliveryStore";
import { closeProjectionDialog, openProjectionReceiver } from "../../src/store/qrProjectionStore";
import { projectionResponse } from "../fixtures/qrProjection";
import { createOverlaySyntheticDispatcher } from "../../src/services/overlaySyntheticDispatch";

vi.mock("../../src/services/api", () => ({ api: { focusOverlayWindow: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("../../src/services/projectionDeliveryReceiver", () => ({ decideDelivery: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../src/services/syncService", () => ({ syncService: { updateBackendRects: vi.fn().mockResolvedValue(undefined) } }));

const invitation = (name = "PC 1", suffix = ""): DeliveryInvitation => {
    const response = projectionResponse();
    return { ...response, envelope: { ...response.envelope, projectionId: response.envelope.projectionId + suffix }, sourceName: name, accepted: false };
};
let dispose: () => void;
let resize: ResizeObserverCallback;
const disconnect = vi.fn();
const panel = () => document.querySelector<HTMLElement>('[aria-label="接收投射确认"]');
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((item) => item.getAttribute("aria-label") === label || item.textContent === label)!;
beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("ResizeObserver", class {
        constructor(callback: ResizeObserverCallback) { resize = callback; }
        observe() {}
        disconnect() { disconnect(); }
    });
    closeProjectionDialog(); setDeliveryBusy(false); setDeliveryError("");
    saveDeliverySettings("https://loom.example.test", "confirm");
    const host = document.createElement("div"); document.body.append(host);
    dispose = render(ProjectionDeliveryPrompt, host);
});
afterEach(() => { dispose(); document.body.replaceChildren(); vi.unstubAllGlobals(); });

it("shows source and count without opening settings or accepting, and routes both decisions", () => {
    const first = invitation(), second = invitation("PC 2", "-2");
    setDeliveryPending([first, second]);
    expect(panel()?.textContent).toContain("PC 1");
    expect(document.querySelector('[aria-label="待处理数量"]')?.textContent).toBe("2");
    expect(decideDelivery).not.toHaveBeenCalled();
    button("接收并显示").click();
    expect(decideDelivery).toHaveBeenLastCalledWith(first, true);
    setDeliveryPending([second]); button("拒绝").click();
    expect(decideDelivery).toHaveBeenLastCalledWith(second, false);
});

it("registers the real native hit rectangle, focuses on pointer and cleans up", () => {
    setDeliveryPending([invitation()]);
    const card = panel()!;
    card.getBoundingClientRect = () => ({ x: 250, y: 60, width: 420, height: 180 }) as DOMRect;
    resize([], {} as ResizeObserver);
    expect(extraRects()).toContainEqual({ id: "projection-delivery-prompt", name: "PROJECTION_DELIVERY_PROMPT", x: 250, y: 60, width: 420, height: 180 });
    expect(syncService.updateBackendRects).toHaveBeenCalled();
    expect(card.dataset.overlaySyntheticTarget).toBe("direct");
    const bubble = vi.fn(); document.body.addEventListener("mousedown", bubble);
    button("接收并显示").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(api.focusOverlayWindow).toHaveBeenCalled(); expect(bubble).not.toHaveBeenCalled();
    document.body.removeEventListener("mousedown", bubble);
    setDeliveryPending([]);
    expect(extraRects().some((rect) => rect.id === "projection-delivery-prompt")).toBe(false);
    expect(disconnect).toHaveBeenCalled();
});

it("preserves the card and keyboard focus across fresh inbox polling objects", () => {
    setDeliveryPending([invitation()]);
    const card = panel(); const accept = button("接收并显示"); accept.focus();
    setDeliveryPending([invitation("Updated name")]);
    expect(panel()).toBe(card); expect(document.activeElement).toBe(accept);
    expect(card?.textContent).toContain("Updated name");
});

it("dismisses only one invitation without rejection and does not reopen it on polling", () => {
    setDeliveryPending([invitation(), invitation("PC 2", "-2")]);
    button("稍后处理投射").click();
    expect(panel()?.textContent).toContain("PC 2"); expect(deliveryPending()).toHaveLength(2);
    button("稍后处理投射").click();
    setDeliveryPending([invitation(), invitation("PC 2", "-2")]);
    expect(panel()).toBeNull(); expect(decideDelivery).not.toHaveBeenCalled();
});

it("replaces action elements when the invitation changes to avoid retargeting an in-progress click", () => {
    setDeliveryPending([invitation()]);
    const old = button("接收并显示");
    setDeliveryPending([invitation("PC 2", "-2")]);
    expect(old.isConnected).toBe(false);
    expect(button("接收并显示")).not.toBe(old);
    old.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(decideDelivery).not.toHaveBeenCalled();
});

it("accepts a native synthetic down/up exactly once and ignores synthetic clicks while busy", () => {
    const item = invitation(); setDeliveryPending([item]);
    const dispatcher = createOverlaySyntheticDispatcher({ doc: document,
        elementFromPoint: () => button("接收并显示"), isLinking: () => false, getDraggingStickerId: () => null });
    dispatcher.dispatch("mousedown", { x: 300, y: 120 });
    dispatcher.dispatch("mouseup", { x: 300, y: 120 });
    expect(decideDelivery).toHaveBeenCalledExactlyOnceWith(item, true);
    setDeliveryBusy(true);
    button("接收并显示").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(decideDelivery).toHaveBeenCalledTimes(1);
    dispatcher.reset();
});

it("hides under an existing settings dialog and for accepted or disabled invitations", () => {
    setDeliveryPending([invitation()]); openProjectionReceiver(); expect(panel()).toBeNull();
    closeProjectionDialog(); expect(panel()).not.toBeNull();
    setDeliveryPending([{ ...invitation(), accepted: true }]); expect(panel()).toBeNull();
    setDeliveryPending([invitation()]); saveDeliverySettings("https://loom.example.test", "disabled");
    expect(panel()).toBeNull();
});

it("blocks duplicate actions while busy and keeps failures available for retry", () => {
    setDeliveryPending([invitation()]); setDeliveryBusy(true);
    button("接收并显示").click(); button("拒绝").click();
    expect(decideDelivery).not.toHaveBeenCalled();
    setDeliveryBusy(false); setDeliveryError("projection_network_error");
    expect(panel()?.querySelector('[role="alert"]')).not.toBeNull();
    button("接收并显示").click(); expect(decideDelivery).toHaveBeenCalledTimes(1);
});
