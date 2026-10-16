/** Preserve edits made across asynchronous commits without silently rebasing conflicts. */
import type { ProjectionEditChange, ProjectionEditDocument, ProjectionEditView } from "../types/projectionEdit";
import type { ProjectionEditJournal } from "./projectionEditJournal";
import { basisEditObjects, documentView, editChanges, editEqual } from "./projectionEditGeometry";

export const mergeEditChanges = (...groups: ProjectionEditChange[][]) =>
    [...new Map(groups.flat().map((item) => [item.objectId, item])).values()];

export function editChangesRace(before: ProjectionEditView, document: ProjectionEditDocument, changes: ProjectionEditChange[]): boolean {
    const objects = basisEditObjects(before, document.basis);
    return changes.some(({ objectId }) => !editEqual(objects[objectId] ?? null, document.objects[objectId]?.value ?? null));
}

interface CommitOperations {
    save: (record: ProjectionEditJournal) => Promise<ProjectionEditJournal>;
    current: () => ProjectionEditView;
    apply: (view: ProjectionEditView) => void;
}

export async function commitProjectionEditView(record: ProjectionEditJournal, document: ProjectionEditDocument,
    observed: ProjectionEditView, overlay: ProjectionEditChange[], ops: CommitOperations, force = false): Promise<ProjectionEditJournal> {
    const view = documentView(document, observed);
    const conflict = record.conflict ? { ...record.conflict, changes: overlay } : undefined;
    if (force || !editEqual(record.document, document) || !editEqual(record.view, view) || !editEqual(record.conflict, conflict)) {
        record = await ops.save({ ...record, document, view, conflict });
    }
    let current = ops.current();
    let duringCommit = editChanges(observed, current, document.basis);
    if (!record.conflict && editChangesRace(observed, document, duringCommit)) {
        record = await ops.save({ ...record, conflict: {
            code: "projection_edit_object_conflict", changes: mergeEditChanges(overlay, duringCommit),
        } });
        current = ops.current();
        duringCommit = editChanges(observed, current, document.basis);
    }
    // This read/merge/apply is synchronous. Any later local edit remains above the
    // authoritative baseline and is either submitted or kept in the sticky conflict.
    ops.apply(documentView(document, current, mergeEditChanges(overlay, duringCommit)));
    return record;
}
