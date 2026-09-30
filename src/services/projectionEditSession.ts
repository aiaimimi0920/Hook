/** Production bindings for the per-Unit edit engine; all rasterization stays in Hook. */
import { createStore } from "solid-js/store";
import { graphStore } from "../store/graphStore";
import { createProjectionEditing, type ProjectionEditStatus } from "./projectionEditEngine";
import { requestProjectionEdit } from "./projectionEditApi";
import { loadProjectionEdit, saveProjectionEdit, forgetProjectionEdit } from "./projectionEditJournal";
import { clearProjectionEditSignature, editEqual, projectionEditSourceSignature } from "./projectionEditGeometry";
import { projectionContext, requestProjection } from "./qrProjectionApi";
import { patchProjection } from "./qrProjectionSession";
import { projectionWorkspaceGeneration } from "./qrProjectionLifecycle";
import { projectionAssociations } from "./projectionSenderBindings";
import { renderProjectionFrame } from "./qrProjectionSnapshot";
import { validateLinkedResponse } from "./qrProjectionSync";
import { clearSyncImageCachesForUnit } from "./syncImageCache";
import { shaderCache } from "./shaderCache";
import { syncService } from "./syncService";

export const [projectionEditStatuses, setProjectionEditStatuses] = createStore<Record<string, ProjectionEditStatus | undefined>>({});

export const projectionEditing = createProjectionEditing({
    unit: (id) => graphStore.units.find((unit) => unit.id === id), generation: projectionWorkspaceGeneration,
    origin: projectionContext, signature: projectionEditSourceSignature,
    render: (unit) => renderProjectionFrame(unit, { withoutAnnotations: true }),
    load: loadProjectionEdit, save: saveProjectionEdit, forget: forgetProjectionEdit, edit: requestProjectionEdit,
    project: (link, request) => requestProjection(request, link.envelope.serverOrigin, link.envelope.protocol, link.offlineTransport),
    publish: (link, response) => {
        const unit = graphStore.units.find((unit) => unit.id === link.localUnitId);
        const binding = unit && projectionAssociations(unit).find((entry) => entry.link.envelope.projectionId === link.envelope.projectionId);
        if (!binding || binding.link.stopped || binding.link.stopPending || response.revision < binding.link.revision) return;
        validateLinkedResponse(binding.link, response);
        const saved = binding.link;
        const next = { ...saved, revision: response.revision, digest: response.digest, linked: response.receiverDeviceId !== null };
        const pixels = saved.role === "receiver" && response.revision > saved.revision ? response.snapshot?.imageBase64 : undefined;
        if (saved.role === "receiver" && response.revision > saved.revision && !pixels) throw new Error("projection_invalid_response");
        if (!editEqual(saved, next) || pixels) patchProjection(saved.localUnitId, next, pixels, binding.key);
    },
    apply: (id, view) => {
        const unit = graphStore.units.find((unit) => unit.id === id);
        if (!unit) return;
        const elements = Object.values(view.objects);
        if (editEqual(unit.data.annotationState?.elements ?? [], elements)) return;
        const serialCounter = elements.reduce((next, annotation) => annotation.type === "serial" && /^\d{1,6}$/.test(annotation.text)
            ? Math.max(next, Number(annotation.text) + 1) : next, unit.data.annotationState?.serialCounter ?? 1);
        clearSyncImageCachesForUnit(id); shaderCache.disposeUnit(id);
        graphStore.actions.updateStickerEditData(id, { annotationState: { elements, serialCounter } }, { markLocalEdit: false });
        graphStore.actions.propagateStickerEditsFrom(id);
        void syncService.performWorkflowSync();
    },
    status: (id, status) => setProjectionEditStatuses(id, status), release: clearProjectionEditSignature,
});

export async function synchronizeProjectionEditing(...args: Parameters<typeof projectionEditing.synchronize>): Promise<boolean> {
    try { return await projectionEditing.synchronize(...args); }
    catch (reason) {
        const [id, , response, current] = args;
        if (current()) setProjectionEditStatuses(id, {
            mode: projectionEditStatuses[id]?.mode ?? response.editing?.mode ?? "one_way",
            pending: projectionEditStatuses[id]?.pending ?? false, conflicts: projectionEditStatuses[id]?.conflicts ?? 0,
            error: reason instanceof Error ? reason.message : String(reason),
        });
        throw reason;
    }
}

let retry: (id: string) => void = () => {};
export function registerProjectionEditRetry(callback: (id: string) => void): () => void {
    retry = callback;
    return () => { if (retry === callback) retry = () => {}; };
}
export async function setProjectionEditMode(id: string, mode: "one_way" | "two_way"): Promise<void> {
    await projectionEditing.setMode(id, mode); retry(id);
}
export async function resolveProjectionEditConflict(id: string, keepLocal: boolean): Promise<void> {
    await projectionEditing.resolve(id, keepLocal); retry(id);
}
