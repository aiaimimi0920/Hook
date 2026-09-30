/** Validate opaque Loom objects before they reach Hook's SVG/canvas renderers. */
import type { StickerAnnotation, StickerStrokeStyle } from "../types/stickerEditing";
import type { ProjectionEditDocument, ProjectionEditRequest, ProjectionEditObjects } from "../types/projectionEdit";

export const editRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export const editIdentifier = (value: unknown): value is string => typeof value === "string"
    && /^[A-Za-z0-9._:/-]{1,160}$/.test(value) && !["__proto__", "constructor", "prototype"].includes(value);
const number = (v: unknown, min = -1_000_000, max = 1_000_000): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const revision = (v: unknown): v is number => number(v, 1, Number.MAX_SAFE_INTEGER) && Number.isSafeInteger(v);
const keys = (v: Record<string, unknown>, names: string[]) => Object.keys(v).every((key) => names.includes(key));
const optionalNumber = (v: unknown, min?: number, max?: number) => v === undefined || number(v, min, max);
const fail = (): never => { throw new Error("projection_edit_invalid_document"); };
const bounded = (v: unknown, max: number) => new TextEncoder().encode(JSON.stringify(v)).byteLength <= max;
const color = (v: unknown) => typeof v === "string" && v.length <= 64
    && (/^#[a-f\d]{3,8}$/i.test(v) || /^(?:rgb|rgba)\([\d.,%\s]+\)$/.test(v) || v === "transparent");

export function parseProjectionAnnotation(value: unknown): StickerAnnotation {
    if (!editRecord(value) || !editIdentifier(value.id) || !number(value.zIndex) || !editRecord(value.style) || !bounded(value, 16 * 1024)) return fail();
    const style = value.style;
    if (!keys(style, ["color", "width", "opacity", "fill", "secondaryFill", "cornerRadius", "dashPattern"])
        || !color(style.color) || !number(style.width, 0, 8192) || !optionalNumber(style.opacity, 0, 1)
        || !optionalNumber(style.cornerRadius, 0, 8192) || (style.fill !== undefined && !color(style.fill))
        || (style.secondaryFill !== undefined && !color(style.secondaryFill))
        || (style.dashPattern !== undefined && !["solid", "dash-1", "dash-2"].includes(String(style.dashPattern)))) return fail();
    const base = ["id", "type", "zIndex", "style"];
    const kind = value.type;
    if (kind === "rect" || kind === "round-rect" || kind === "ellipse" || kind === "triangle" || kind === "polygon") {
        if (!keys(value, [...base, "x", "y", "w", "h", "rotation", "sides"]) || !number(value.x) || !number(value.y)
            || !number(value.w, 0) || !number(value.h, 0) || !optionalNumber(value.rotation, -36000, 36000)
            || (value.sides !== undefined && (!number(value.sides, 3, 64) || !Number.isInteger(value.sides)))) return fail();
    } else if (kind === "line" || kind === "polyline" || kind === "arrow" || kind === "brush" || kind === "highlighter") {
        if (!keys(value, [...base, "points"]) || !Array.isArray(value.points) || !value.points.length || value.points.length > 2048
            || value.points.some((p: unknown) => !editRecord(p) || !keys(p, ["x", "y"]) || !number(p.x) || !number(p.y))) return fail();
    } else if (kind === "text" || kind === "serial") {
        if (!keys(value, [...base, "x", "y", "text", "fontSize", "fontFamily", "rotation"]) || !number(value.x) || !number(value.y)
            || typeof value.text !== "string" || value.text.length > 4096 || !optionalNumber(value.fontSize, 1, 8192)
            || !optionalNumber(value.rotation, -36000, 36000)
            || (value.fontFamily !== undefined && (typeof value.fontFamily !== "string" || value.fontFamily.length > 128 || /[;{}\r\n]/.test(value.fontFamily)))) return fail();
    } else return fail();
    return JSON.parse(JSON.stringify({ ...value, style: style as unknown as StickerStrokeStyle })) as StickerAnnotation;
}

export function parseProjectionEditObjects(value: unknown): ProjectionEditObjects {
    if (!editRecord(value) || Object.keys(value).length > 256 || !bounded(value, 256 * 1024)) return fail();
    return Object.fromEntries(Object.entries(value).map(([id, object]) => {
        const parsed = parseProjectionAnnotation(object);
        if (parsed.id !== id) return fail();
        return [id, parsed];
    }));
}

export function parseProjectionEditDocument(value: unknown): ProjectionEditDocument {
    if (!editRecord(value) || !keys(value, ["schema", "sessionId", "basis", "revision", "modeRevision", "checkpointRevision", "receiptCount", "mode", "objects"])
        || value.schema !== "neuro.projection-edit.v1" || typeof value.sessionId !== "string" || !/^edit:[a-f0-9]{32}$/.test(value.sessionId)
        || !revision(value.revision) || !revision(value.modeRevision) || value.modeRevision > value.revision
        || !revision(value.checkpointRevision) || value.checkpointRevision > value.modeRevision
        || !number(value.receiptCount, 0, 256) || !Number.isInteger(value.receiptCount)
        || (value.mode !== "one_way" && value.mode !== "two_way") || !editRecord(value.basis)
        || !keys(value.basis, ["digest", "width", "height"]) || typeof value.basis.digest !== "string" || !/^[a-f0-9]{64}$/.test(value.basis.digest)
        || !revision(value.basis.width) || !revision(value.basis.height) || value.basis.width > 8192 || value.basis.height > 8192
        || value.basis.width * value.basis.height > 16_777_216 || !editRecord(value.objects)
        || Object.keys(value.objects).length > 256 || !bounded(value, 256 * 1024)) return fail();
    const objects: ProjectionEditDocument["objects"] = {};
    for (const [id, item] of Object.entries(value.objects)) {
        if (!editIdentifier(id) || !editRecord(item) || !keys(item, ["revision", "value"]) || !revision(item.revision) || item.revision > value.revision) return fail();
        const annotation = item.value === null ? null : parseProjectionAnnotation(item.value);
        if (annotation && annotation.id !== id) return fail();
        objects[id] = { revision: item.revision, value: annotation };
    }
    return { ...value, objects } as unknown as ProjectionEditDocument;
}

export function parseProjectionEditRequest(value: unknown): ProjectionEditRequest {
    if (!editRecord(value) || typeof value.projectionId !== "string" || !/^projection:[a-f0-9]{32}$/i.test(value.projectionId)
        || !bounded(value, 256 * 1024)) return fail();
    const common = ["operation", "projectionId", "sessionId"];
    if (value.operation !== "read" && (typeof value.sessionId !== "string" || !/^edit:[a-f0-9]{32}$/.test(value.sessionId))) return fail();
    switch (value.operation) {
        case "read": if (!keys(value, ["operation", "projectionId"])) return fail(); break;
        case "attach": if (!keys(value, common)) return fail(); break;
        case "initialize":
            if (!keys(value, [...common, "expectedDigest", "objects"]) || typeof value.expectedDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.expectedDigest)) return fail();
            parseProjectionEditObjects(value.objects); break;
        case "mode":
            if (!keys(value, [...common, "opId", "baseModeRevision", "mode"]) || !editIdentifier(value.opId) || !revision(value.baseModeRevision)
                || (value.mode !== "one_way" && value.mode !== "two_way")) return fail(); break;
        case "apply": {
            if (!keys(value, [...common, "opId", "baseRevision", "modeRevision", "changes"]) || !editIdentifier(value.opId)
                || !revision(value.baseRevision) || !revision(value.modeRevision) || !Array.isArray(value.changes)
                || !value.changes.length || value.changes.length > 32) return fail();
            const ids = new Set<string>();
            for (const item of value.changes) {
                if (!editRecord(item) || !keys(item, ["objectId", "value"]) || !editIdentifier(item.objectId) || ids.has(item.objectId)) return fail();
                ids.add(item.objectId);
                if (item.value !== null && parseProjectionAnnotation(item.value).id !== item.objectId) return fail();
            }
            break;
        }
        case "checkpoint": if (!keys(value, [...common, "expectedRevision"]) || !revision(value.expectedRevision)) return fail(); break;
        default: return fail();
    }
    return value as unknown as ProjectionEditRequest;
}
