import { graphStore } from "../../workspace/state/graphStore";
import { selectionActions } from "../../workspace/state/uiStore";
import { openProjectionReceiver } from "../state/qrProjectionStore";
import { syncService } from "../../workspace/services/syncService";

/** The tray creates a real local sticker; closing import leaves it available for reuse. */
export function openTrayProjectionReceiver(): string {
    const id = crypto.randomUUID();
    const w = Math.max(1, Math.min(480, window.innerWidth - 32));
    const h = Math.max(1, Math.min(360, window.innerHeight - 32));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("projection_canvas_unavailable");
    context.fillStyle = "#666666";
    context.fillRect(0, 0, w, h);
    graphStore.actions.addUnit({
        id, type: "sticker", x: Math.max(0, (window.innerWidth - w) / 2), y: Math.max(0, (window.innerHeight - h) / 2), w, h,
        params: {}, inputs: [{ id: "image", type: "image", direction: "input", label: "Image" }],
        outputs: [{ id: "output_image", type: "image", direction: "output", label: "Image" }],
        data: { src: canvas.toDataURL("image/png"), opacityNormal: 1, opacityMini: 0.9 },
    });
    selectionActions.set([id]);
    void syncService.updateBackendRects();
    void syncService.performWorkflowSync();
    // Let Solid mount the sticker before the dialog captures its anchor element.
    queueMicrotask(() => {
        if (graphStore.units.some((unit) => unit.id === id)) openProjectionReceiver("", "qr", id, id);
    });
    return id;
}
