import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Show } from "solid-js";
import { render } from "solid-js/web";
import { QrProjectionDialog } from "../../src/components/QrProjectionDialog";
import { openProjection, openProjectionReceiver, projectionDialog, closeProjectionDialog } from "../../src/store/qrProjectionStore";
import { extraRects } from "../../src/services/uiRegistry";

vi.mock("../../src/components/QrProjectionSender", () => ({ QrProjectionSender: () => <input aria-label="投射链接" readOnly value="hook://projection/v1#test" /> }));
vi.mock("../../src/components/QrProjectionReceiver", () => ({ QrProjectionReceiver: () => null }));
vi.mock("../../src/components/ProjectionBatchSender", () => ({ ProjectionBatchSender: () => null }));
vi.mock("../../src/services/syncService", () => ({ syncService: { updateBackendRects: vi.fn(async () => undefined) } }));
let dispose: (() => void) | undefined;
let anchor: HTMLDivElement;
let trigger: HTMLButtonElement;
let anchorRect: DOMRect;
let resize: () => void;
const rect = () => extraRects().find((item) => item.id === "qr-projection-dialog");
beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
    anchor = document.createElement("div"); anchor.dataset.unitId = "source";
    anchorRect = new DOMRect(400, 300, 100, 60);
    trigger = document.createElement("button"); document.body.append(anchor, trigger); trigger.focus();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        return this === anchor ? anchorRect : new DOMRect(parseFloat(this.style.left) || 0, parseFloat(this.style.top) || 0, 312, 356);
    });
    openProjection("source", "qr");
    dispose = render(() => <Show when={projectionDialog()}>{(target) => <QrProjectionDialog target={target()} retry={vi.fn()} />}</Show>, document.body);
});
afterEach(() => { dispose?.(); closeProjectionDialog(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("centers on a small sticker, registers the entire overflow, and cleans up on close", async () => {
    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(panel.getAttribute("aria-modal")).toBe("false");
    expect(panel.parentElement?.classList.contains("qr-projection-backdrop--share")).toBe(true);
    expect(panel.querySelector("h2, footer")).toBeNull();
    expect(panel.querySelectorAll("button")).toHaveLength(1);
    expect(rect()).toMatchObject({ x: 294, y: 152, width: 312, height: 356 });
    anchorRect = new DOMRect(450, 320, 100, 60); anchor.style.transform = "translate(50px, 20px)";
    await vi.waitFor(() => expect(rect()).toMatchObject({ x: 344, y: 172 }));
    panel.querySelector<HTMLButtonElement>("button")!.click();
    expect(rect()).toBeUndefined(); expect(document.activeElement).toBe(trigger);
    resize(); window.dispatchEvent(new Event("resize"));
    expect(rect()).toBeUndefined();
});

it("keeps the complete popup on-screen near a viewport edge and supports Escape", () => {
    anchorRect = new DOMRect(-20, -10, 40, 30); resize();
    expect(rect()).toMatchObject({ x: 8, y: 8, width: 312, height: 356 });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(rect()).toBeUndefined(); expect(document.activeElement).toBe(trigger);
});

it("anchors imports to the selected sticker without rendering the sender or explanatory shell", () => {
    closeProjectionDialog();
    anchorRect = new DOMRect(80, 100, 480, 400);
    openProjectionReceiver("", "combined", "source");
    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(panel.getAttribute("aria-label")).toBe("导入投射");
    expect(panel.getAttribute("aria-modal")).toBe("false");
    expect(panel.querySelector("h2, footer, input")).toBeNull();
    expect(rect()).toMatchObject({ x: 164, y: 122 });
    anchorRect = new DOMRect(140, 160, 480, 400); resize();
    expect(rect()).toMatchObject({ x: 224, y: 182 });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(rect()).toBeUndefined();
});
