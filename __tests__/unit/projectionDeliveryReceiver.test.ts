import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDeliveryReceiver, decideDelivery, receiveDelivery } from "../../src/services/projectionDeliveryReceiver";
import { deliveryInbox, deliveryReceipt, type DeliveryInvitation } from "../../src/services/projectionDeliveryApi";
import { deliveryPending, deliverySettings, saveDeliverySettings, setDeliveryBusy } from "../../src/store/projectionDeliveryStore";
import { requestProjection } from "../../src/services/qrProjectionApi";
import { attachProjectionReceiver } from "../../src/services/qrProjectionSession";
import { queueProjectionUnlink } from "../../src/services/qrProjectionCleanup";
import { invalidateProjectionUnit, invalidateProjectionWorkspace } from "../../src/services/qrProjectionLifecycle";
import { graphStore } from "../../src/store/graphStore";
import { closeProjectionDialog, projectionDialog } from "../../src/store/qrProjectionStore";
import { projectionResponse, projectionUnit } from "../fixtures/qrProjection";
import type { Unit } from "../../src/types/unit";
import { syncService } from "../../src/services/syncService";
import { render } from "solid-js/web";
import { QrProjectionFeatures } from "../../src/components/QrProjectionFeatures";

vi.mock("../../src/services/projectionDeliveryApi", () => ({ deliveryInbox: vi.fn(), deliveryReceipt: vi.fn() }));
vi.mock("../../src/services/qrProjectionApi", () => ({ requestProjection: vi.fn(), unlinkProjection: vi.fn() }));
vi.mock("../../src/services/qrProjectionSession", () => ({ attachProjectionReceiver: vi.fn(), patchProjection: vi.fn() }));
vi.mock("../../src/services/qrProjectionCleanup", () => ({ queueProjectionUnlink: vi.fn(), createProjectionCleanup: () => ({ dispose: vi.fn() }) }));
vi.mock("../../src/services/qrProjectionSync", () => ({ createProjectionSync: () => ({ dispose: vi.fn(), retry: vi.fn() }) }));
vi.mock("../../src/services/qrProjectionSnapshot", () => ({ projectionContentSignature: vi.fn(), renderProjectionFrame: vi.fn() }));
vi.mock("../../src/services/apiTransport", () => ({ isTauriRuntimeAvailable: () => true }));
vi.mock("../../src/services/appStartupState", () => ({ startupSessionReady: () => true }));
vi.mock("../../src/components/QrProjectionDialog", () => ({ QrProjectionDialog: () => null }));
vi.mock("../../src/store/graphStore", () => ({ graphStore: { units: [] as Unit[] } }));
vi.mock("../../src/services/syncService", () => ({ syncService: { persistPendingChanges: vi.fn() } }));
const invitation = (): DeliveryInvitation => ({ ...projectionResponse(), sourceName: "PC 1", accepted: false });
let receiver: ReturnType<typeof createDeliveryReceiver> | undefined;

beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(1000); setDeliveryBusy(false); closeProjectionDialog();
    graphStore.units.splice(0); document.body.replaceChildren();
    saveDeliverySettings("https://loom.example.test", "confirm");
    vi.mocked(deliveryInbox).mockResolvedValue([invitation()]);
    vi.mocked(deliveryReceipt).mockResolvedValue(undefined);
    vi.mocked(syncService.persistPendingChanges).mockResolvedValue(undefined);
    vi.mocked(requestProjection).mockResolvedValue(projectionResponse());
    vi.mocked(attachProjectionReceiver).mockImplementation((id, response) => {
        const unit = projectionUnit("receiver"); unit.id = id;
        unit.data.src = "data:image/png;base64," + response.snapshot!.imageBase64;
        unit.data.qrProjection = { ...unit.data.qrProjection!, envelope: response.envelope, localUnitId: id };
        graphStore.units.push(unit);
        const host = document.createElement("div"); host.dataset.unitId = id;
        const image = document.createElement("img"); image.dataset.stickerBaseImage = "true"; image.src = unit.data.src;
        image.style.opacity = "1";
        Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 1 } });
        image.getBoundingClientRect = () => ({ width: 100, height: 100 }) as DOMRect;
        host.append(image); document.body.append(host);
    });
});
afterEach(() => { receiver?.dispose(); receiver = undefined; vi.useRealTimers(); vi.resetAllMocks(); document.body.replaceChildren(); });

it("prompts in confirm mode without accepting, then rejects only the selected delivery", async () => {
    receiver = createDeliveryReceiver(); await vi.advanceTimersByTimeAsync(0);
    expect(projectionDialog()).toEqual({ invitationText: "" });
    expect(requestProjection).not.toHaveBeenCalled(); expect(deliveryPending()).toHaveLength(1);
    await decideDelivery(invitation(), false);
    expect(deliveryReceipt).toHaveBeenCalledWith(deliverySettings().origin, invitation().envelope.projectionId, "rejected");
    expect(attachProjectionReceiver).not.toHaveBeenCalled(); expect(deliveryPending()).toHaveLength(0);
});

it("auto accepts and sends a display receipt only after rendered image; retries do not duplicate units", async () => {
    saveDeliverySettings(deliverySettings().origin, "auto"); receiver = createDeliveryReceiver();
    await vi.advanceTimersByTimeAsync(0);
    expect(attachProjectionReceiver).toHaveBeenCalledTimes(1);
    expect(deliveryReceipt).toHaveBeenCalledWith(deliverySettings().origin, invitation().envelope.projectionId, "displayed");
    await receiveDelivery({ ...invitation(), accepted: true }, () => true);
    expect(attachProjectionReceiver).toHaveBeenCalledTimes(1); expect(requestProjection).toHaveBeenCalledTimes(1);
});

it.each(["workspace", "delete", "dispose"])("does not attach a late acceptance after %s", async (reason) => {
    saveDeliverySettings(deliverySettings().origin, "auto");
    let resolve!: (value: ReturnType<typeof projectionResponse>) => void;
    vi.mocked(requestProjection).mockImplementation(() => new Promise((done) => { resolve = done; }));
    receiver = createDeliveryReceiver(); await vi.advanceTimersByTimeAsync(0);
    if (reason === "workspace") invalidateProjectionWorkspace();
    else if (reason === "delete") invalidateProjectionUnit("delivery-" + invitation().envelope.projectionId.slice("projection:".length));
    else receiver.dispose();
    resolve(projectionResponse()); await vi.advanceTimersByTimeAsync(0);
    expect(attachProjectionReceiver).not.toHaveBeenCalled(); expect(deliveryReceipt).not.toHaveBeenCalled();
    expect(queueProjectionUnlink).toHaveBeenCalled();
});

it("does not report displayed when the sticker image is not visible", async () => {
    await receiveDelivery(invitation(), () => true); vi.mocked(deliveryReceipt).mockClear();
    document.querySelector("img")!.style.visibility = "hidden";
    const result = receiveDelivery({ ...invitation(), accepted: true }, () => true);
    const failure = expect(result).rejects.toThrow("projection_display_pending");
    await vi.advanceTimersByTimeAsync(3100); await failure;
    expect(deliveryReceipt).not.toHaveBeenCalled();
});

it("disabled receiver never polls", async () => {
    saveDeliverySettings(deliverySettings().origin, "disabled"); receiver = createDeliveryReceiver();
    await vi.advanceTimersByTimeAsync(30_000); expect(deliveryInbox).not.toHaveBeenCalled();
});

it("keeps the mounted receiver alive while auto acceptance changes busy state", async () => {
    saveDeliverySettings(deliverySettings().origin, "auto");
    vi.mocked(deliveryInbox).mockResolvedValue([]).mockResolvedValueOnce([invitation()]);
    const host = document.createElement("div"); document.body.append(host);
    const dispose = render(QrProjectionFeatures, host);
    try {
        await vi.advanceTimersByTimeAsync(0);
        expect(attachProjectionReceiver).toHaveBeenCalledTimes(1);
        expect(deliveryReceipt).toHaveBeenCalledWith(deliverySettings().origin, invitation().envelope.projectionId, "displayed");
        expect(queueProjectionUnlink).not.toHaveBeenCalled();
    } finally { dispose(); }
});

it("does not claim display if durable saving fails", async () => {
    vi.mocked(syncService.persistPendingChanges).mockRejectedValue(new Error("disk unavailable"));
    await expect(receiveDelivery(invitation(), () => true)).rejects.toThrow("disk unavailable");
    expect(attachProjectionReceiver).toHaveBeenCalledTimes(1); expect(deliveryReceipt).not.toHaveBeenCalled();
});
