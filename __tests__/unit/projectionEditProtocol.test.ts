import { expect, it } from "vitest";
import { parseProjectionAnnotation, parseProjectionEditDocument, parseProjectionEditRequest } from "../../src/services/projectionEditProtocol";
import { basisEditObjects, documentView, editChanges, projectionEditView, scaleEditObjects } from "../../src/services/projectionEditGeometry";
import { editDocument, editShape } from "../fixtures/projectionEdit";
import { projectionUnit } from "../fixtures/qrProjection";

it("validates renderable objects and rejects unsafe identities, fields, numbers and budgets", () => {
    expect(parseProjectionAnnotation(editShape())).toEqual(editShape());
    for (const value of [
        { ...editShape(), id: "__proto__" }, { ...editShape(), x: Infinity }, { ...editShape(), type: "mosaic" },
        { ...editShape(), style: { color: "url(https://invalid.test/a)", width: 1 } },
        { ...editShape(), script: "unexpected" }, { ...editShape(), type: "brush", points: Array(2049).fill({ x: 0, y: 0 }) },
    ]) expect(() => parseProjectionAnnotation(value)).toThrow("projection_edit_invalid_document");
    const document = editDocument();
    expect(parseProjectionEditDocument(document)).toEqual(document);
    expect(() => parseProjectionEditDocument({ ...document, modeRevision: 9 })).toThrow();
    expect(() => parseProjectionEditDocument({ ...document, checkpointRevision: 3 })).toThrow();
    expect(() => parseProjectionEditDocument({ ...document, objects: { wrong: document.objects["shape-a"] } })).toThrow();
});

it("rejects ambiguous operation batches and keeps opaque fields outside the native request", () => {
    const request = { operation: "apply", projectionId: `projection:${"1".repeat(32)}`, sessionId: editDocument().sessionId,
        opId: "op:one", baseRevision: 2, modeRevision: 2, changes: [{ objectId: "shape-a", value: editShape() }] };
    expect(parseProjectionEditRequest(request)).toEqual(request);
    expect(() => parseProjectionEditRequest({ ...request, actor: "forged" })).toThrow();
    expect(() => parseProjectionEditRequest({ ...request, changes: [...request.changes, ...request.changes] })).toThrow();
    expect(() => parseProjectionEditRequest({ ...request, changes: Array(33).fill(request.changes[0]) })).toThrow();
});

it("does not turn frame movement or resizing into an object edit and inverts unequal axis scales", () => {
    const document = editDocument();
    const before = documentView(document, { w: 120, h: 100 });
    const resized = { w: 240, h: 100, objects: scaleEditObjects(before, { w: 240, h: 100 }) };
    expect(editChanges(before, resized, document.basis)).toEqual([]);
    expect(basisEditObjects(resized, document.basis)).toEqual(before.objects);
    const shape = resized.objects["shape-a"];
    if (shape.type !== "rect") throw new Error("fixture");
    shape.x += 20;
    expect(editChanges(before, resized, document.basis)).toEqual([{ objectId: "shape-a", value: editShape("shape-a", 20) }]);
    const unit = projectionUnit();
    unit.data.annotationState = { elements: [editShape()], serialCounter: 1 };
    const view = projectionEditView(unit); unit.x += 500; unit.y -= 100;
    expect(projectionEditView(unit)).toEqual(view);
});

it("keeps receiver image transforms outside the shared coordinate space", () => {
    const unit = projectionUnit("receiver");
    unit.data.imageEditState = { rotation: 90, contentEraseStrokes: [] };
    expect(() => projectionEditView(unit)).toThrow("projection_edit_unsupported_basis");
});
