/** Shared objects use basis pixels; desktop position and frame scaling stay local. */
import { unwrap } from "solid-js/store";
import type { Unit } from "../types/unit";
import type { ProjectionEditBasis, ProjectionEditChange, ProjectionEditDocument, ProjectionEditObjects, ProjectionEditView } from "../types/projectionEdit";
import { scaleStickerAnnotationState } from "./stickerEditPropagation";
import { buildSerialAnnotationMetrics } from "./stickerEditing";
import { resolveBakedStickerSyncSize } from "./syncedImagePayload";
import { parseProjectionAnnotation, parseProjectionEditObjects } from "./projectionEditProtocol";
import { resolveRuntimeStickerCompositeBaseImageSrc } from "./stickerExportSource";

export const editEqual = (a: unknown, b: unknown): boolean => {
    const canonical = (value: unknown): unknown => typeof value === "number" ? Math.round(value * 1e6) / 1e6
        : Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
    return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
};

export function projectionEditView(unit: Unit): ProjectionEditView {
    const image = unit.data.imageEditState;
    if (unit.data.qrProjection?.role === "receiver" && (unit.data.rasterizedAnnotationLayerSrc
        || image?.cropRect || image?.rotation || image?.flippedX || image?.flippedY || image?.contentEraseStrokes?.length
        || image?.beautify?.enabled || image?.borderWidth || image?.cornerRadius)) throw new Error("projection_edit_unsupported_basis");
    const size = resolveBakedStickerSyncSize(unit);
    if (!Number.isFinite(size.w) || !Number.isFinite(size.h) || size.w <= 0 || size.h <= 0) throw new Error("projection_edit_invalid_document");
    const objects: ProjectionEditObjects = {};
    for (const raw of unit.data.annotationState?.elements ?? []) {
        if (raw.type === "mosaic" || raw.type === "blur") throw new Error("projection_edit_unsupported_annotation");
        const object = parseProjectionAnnotation(unwrap(raw));
        if (Object.hasOwn(objects, object.id)) throw new Error("projection_edit_invalid_document");
        if ((object.type === "text" || object.type === "serial") && object.fontSize === undefined) {
            object.fontSize = object.type === "serial" ? buildSerialAnnotationMetrics(object.style.cornerRadius ?? 14).fontSize : 18;
        }
        objects[object.id] = object;
    }
    return { ...size, objects: parseProjectionEditObjects(objects) };
}

export function scaleEditObjects(view: ProjectionEditView, size: { w: number; h: number }): ProjectionEditObjects {
    const elements = scaleStickerAnnotationState({ elements: Object.values(view.objects), serialCounter: 1 }, view, size)!.elements;
    return Object.fromEntries(elements.map((item) => [item.id, item]));
}

export function basisEditObjects(view: ProjectionEditView, basis: ProjectionEditBasis): ProjectionEditObjects {
    const objects = scaleEditObjects(view, { w: basis.width, h: basis.height });
    // Scalar stroke/font sizes use the inverse of the forward scale. The average
    // of reciprocal axes would inflate them after a non-uniform frame resize.
    const scalar = (view.w / basis.width + view.h / basis.height) / 2;
    for (const [id, object] of Object.entries(objects)) {
        const local = view.objects[id];
        object.style.width = local.style.width / scalar;
        if (local.style.cornerRadius !== undefined) object.style.cornerRadius = local.style.cornerRadius / scalar;
        if ((object.type === "text" || object.type === "serial") && (local.type === "text" || local.type === "serial") && local.fontSize !== undefined) {
            object.fontSize = local.fontSize / scalar;
        }
    }
    return objects;
}

export function editChanges(previous: ProjectionEditView, current: ProjectionEditView, basis: ProjectionEditBasis): ProjectionEditChange[] {
    const expected = scaleEditObjects(previous, current);
    const canonical = basisEditObjects(current, basis);
    return [...new Set([...Object.keys(expected), ...Object.keys(current.objects)])].sort()
        .filter((id) => !editEqual(expected[id], current.objects[id]))
        .map((objectId) => ({ objectId, value: canonical[objectId] ?? null }));
}

export function documentView(document: ProjectionEditDocument, size: { w: number; h: number }, overlay: ProjectionEditChange[] = []): ProjectionEditView {
    const objects = Object.fromEntries(Object.entries(document.objects).flatMap(([id, item]) => item.value ? [[id, item.value]] : []));
    for (const change of overlay) { if (change.value) objects[change.objectId] = change.value; else delete objects[change.objectId]; }
    return { ...size, objects: scaleEditObjects({ w: document.basis.width, h: document.basis.height, objects }, size) };
}

const signatures = new Map<string, { fields: unknown[]; value: Promise<string> }>();
export function projectionEditSourceSignature(unit: Unit): Promise<string> {
    if (unit.data.imageEditState?.beautify?.enabled || (unit.data.imageEditState?.cornerRadius ?? 0) > 0) throw new Error("projection_edit_unsupported_basis");
    const fields = [resolveRuntimeStickerCompositeBaseImageSrc(unit), unit.data.filePath,
        JSON.stringify(unit.data.imageEditState), unit.data.rasterizedAnnotationLayerSrc,
        JSON.stringify([unit.data.stickerEditPropagation?.upstreamSourceFrame, unit.data.stickerEditPropagation?.upstreamContentFrame])];
    const previous = signatures.get(unit.id);
    if (previous && fields.every((value, index) => value === previous.fields[index])) return previous.value;
    if (signatures.size >= 64) signatures.delete(signatures.keys().next().value!);
    const value = crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(fields)))
        .then((hash) => Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join(""));
    signatures.set(unit.id, { fields, value });
    return value;
}
export const clearProjectionEditSignature = (id: string) => { signatures.delete(id); };
