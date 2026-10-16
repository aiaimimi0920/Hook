import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { graphStore } from "../../src/features/workspace/state/graphStore";
import { closeProjectionDialog, projectionDialog } from "../../src/features/projection/state/qrProjectionStore";
import { openTrayProjectionReceiver } from "../../src/features/projection/services/projectionReceivePlaceholder";
import { attachProjectionReceiver } from "../../src/features/projection/services/qrProjectionSession";
import { syncService } from "../../src/features/workspace/services/syncService";
import { projectionResponse } from "../fixtures/qrProjection";

describe("tray projection receiver placeholder", () => {
    beforeEach(() => {
        vi.spyOn(syncService, "performWorkflowSync").mockResolvedValue(undefined);
        vi.spyOn(syncService, "updateBackendRects").mockResolvedValue(undefined);
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect: vi.fn(), fillStyle: "" } as unknown as CanvasRenderingContext2D);
        vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,blank");
    });
    afterEach(() => { closeProjectionDialog(); graphStore.actions.replaceUnits([]); vi.restoreAllMocks(); });

    it("creates a blank sticker and opens the existing QR import anchored inside it", async () => {
        const id = openTrayProjectionReceiver();
        await Promise.resolve();
        expect(graphStore.units).toHaveLength(1);
        expect(vi.mocked(HTMLCanvasElement.prototype.getContext).mock.results[0].value.fillStyle).toBe("#666666");
        expect(graphStore.units[0]).toMatchObject({ id, type: "sticker", data: { src: "data:image/png;base64,blank" } });
        expect(projectionDialog()).toMatchObject({ anchorUnitId: id, receiverUnitId: id, importKind: "qr" });
        closeProjectionDialog();
        expect(graphStore.units).toHaveLength(1);
    });

    it("fills the same sticker after acceptance without duplicating or moving it", async () => {
        const id = openTrayProjectionReceiver();
        await Promise.resolve();
        graphStore.actions.updateUnit(id, { x: 123, y: 87 });
        const response = { ...projectionResponse(), receiverUnitId: id };
        attachProjectionReceiver(id, response, true);
        expect(graphStore.units).toHaveLength(1);
        expect(graphStore.units[0]).toMatchObject({ id, x: 123, y: 87, data: {
            src: `data:image/png;base64,${response.snapshot!.imageBase64}`, qrProjection: { role: "receiver", localUnitId: id },
        } });
        expect(() => attachProjectionReceiver(id, response, true)).toThrow("projection_invalid_response");
    });

    it("does not recreate a removed placeholder when acceptance arrives late", async () => {
        const id = openTrayProjectionReceiver();
        graphStore.actions.removeUnit(id);
        await Promise.resolve();
        expect(projectionDialog()).toBeUndefined();
        expect(() => attachProjectionReceiver(id, { ...projectionResponse(), receiverUnitId: id }, true)).toThrow();
        expect(graphStore.units).toHaveLength(0);
    });
});
