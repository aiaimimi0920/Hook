import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { For } from "solid-js";
import { render } from "solid-js/web";
import { ProjectionDeliveryPrompt } from "../../src/features/projection/components/ProjectionDeliveryPrompt";
import { createDeliveryReceiver } from "../../src/features/projection/services/projectionDeliveryReceiver";
import { safeInvoke } from "../../src/platform/tauri/apiTransport";
import { requestProjection } from "../../src/features/projection/services/qrProjectionApi";
import { syncService } from "../../src/features/workspace/services/syncService";
import { graphStore } from "../../src/features/workspace/state/graphStore";
import { saveDeliverySettings, setDeliveryBusy, setDeliveryError } from "../../src/features/projection/state/projectionDeliveryStore";
import { closeProjectionDialog } from "../../src/features/projection/state/qrProjectionStore";
import { projectionEnvelope, projectionResponse, projectionUnit } from "../fixtures/qrProjection";
import { saveProjectionReceivePolicy } from "../../src/features/projection/state/projectionReceivePolicyStore";

// Keep inbox parsing, receiver decisions, graph insertion and the approval component real.
vi.mock("../../src/platform/tauri/apiTransport", async (original) => ({
    ...await original<typeof import("../../src/platform/tauri/apiTransport")>(), safeInvoke: vi.fn(),
}));
vi.mock("../../src/features/projection/services/qrProjectionApi", () => ({ requestProjection: vi.fn() }));
let receiver: ReturnType<typeof createDeliveryReceiver> | undefined;
let dispose: (() => void) | undefined;
let policy: "auto" | "confirm";
let delivered: boolean;
const envelope = projectionEnvelope();

beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    setDeliveryBusy(false); setDeliveryError(""); closeProjectionDialog();
    graphStore.actions.replaceUnits([]);
    const existing = projectionUnit(); existing.id = "existing-local";
    graphStore.actions.addUnit(existing);
    saveDeliverySettings(envelope.serverOrigin, "confirm");
    delivered = false; policy = "confirm";
    saveProjectionReceivePolicy("confirm");
    vi.spyOn(syncService, "persistPendingChanges").mockResolvedValue(undefined);
    vi.spyOn(syncService, "performWorkflowSync").mockResolvedValue(undefined);
    vi.spyOn(syncService, "updateBackendRects").mockResolvedValue(undefined);
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1);
    vi.spyOn(HTMLImageElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 100, height: 100 } as DOMRect);
    vi.mocked(safeInvoke).mockImplementation(async (_command, args) => {
        const operation = args?.operation as { kind: string; status?: string };
        if (args?.offlineRoute) throw new Error("lan_request_rejected");
        if (operation.kind === "receipt") { delivered = true; return { recorded: true }; }
        return { offlinePeers: true, invitations: delivered ? [] : [{ envelope, revision: 1, digest: "a".repeat(64),
            sourceName: "PC 1", receivePolicy: policy, delivery: { status: "awaiting_confirmation" } }] };
    });
    vi.mocked(requestProjection).mockImplementation(async (operation) => ({ ...projectionResponse(),
        receiverUnitId: operation.kind === "accept" ? operation.receiverUnitId : "unexpected" }));
    const host = document.createElement("div"); document.body.append(host);
    dispose = render(() => <><ProjectionDeliveryPrompt /><For each={graphStore.units}>{(unit) =>
        <div data-unit-id={unit.id}><img data-sticker-base-image src={unit.data.src} style={{ opacity: 1 }} /></div>
    }</For></>, host);
});

afterEach(() => {
    receiver?.dispose(); receiver = undefined; dispose?.(); dispose = undefined;
    graphStore.actions.replaceUnits([]); document.body.replaceChildren();
    vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

it("sender push under auto policy creates a new sticker without any pasted link", async () => {
    saveProjectionReceivePolicy("auto");
    policy = "auto"; receiver = createDeliveryReceiver();
    await vi.advanceTimersByTimeAsync(100);
    expect(document.querySelector('[aria-label="接收投射确认"]')).toBeNull();
    expect(graphStore.units).toHaveLength(2);
    expect(graphStore.units[1].data.qrProjection).toMatchObject({ role: "receiver", envelope });
    expect(graphStore.units[0].id).toBe("existing-local");
    expect(requestProjection).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: "accept", envelope }));
    expect(delivered).toBe(true);
    await vi.advanceTimersByTimeAsync(4000);
    expect(graphStore.units).toHaveLength(2);
});

it("sender push under confirm policy creates nothing until desktop approval", async () => {
    receiver = createDeliveryReceiver(); await vi.advanceTimersByTimeAsync(0);
    expect(graphStore.units).toHaveLength(1); expect(requestProjection).not.toHaveBeenCalled();
    const card = document.querySelector('[aria-label="接收投射确认"]')!;
    expect(card.textContent).toContain("PC 1");
    [...card.querySelectorAll("button")].find((button) => button.textContent === "接收并显示")!.click();
    await vi.advanceTimersByTimeAsync(100);
    expect(graphStore.units).toHaveLength(2);
    expect(graphStore.units[1].data.qrProjection?.role).toBe("receiver");
    expect(delivered).toBe(true);
    expect(document.querySelector('[aria-label="接收投射确认"]')).toBeNull();
});

it("desktop rejection never creates a new sticker or accepts the invitation", async () => {
    receiver = createDeliveryReceiver(); await vi.advanceTimersByTimeAsync(0);
    const card = document.querySelector('[aria-label="接收投射确认"]')!;
    [...card.querySelectorAll("button")].find((button) => button.textContent === "拒绝")!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(graphStore.units).toHaveLength(1); expect(requestProjection).not.toHaveBeenCalled();
    expect(safeInvoke).toHaveBeenCalledWith("projection_request", expect.objectContaining({
        operation: { kind: "receipt", projectionId: envelope.projectionId, status: "rejected" },
    }));
});
