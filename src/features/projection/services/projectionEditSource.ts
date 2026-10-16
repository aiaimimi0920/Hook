/** Resume the same source document and image basis across response loss and multiple targets. */
import type { ProjectionResponse, QrProjectionLink } from "../types/qrProjection";
import type { ProjectionEditDocument, ProjectionEditRequest } from "../types/projectionEdit";
import type { ProjectionEditJournal } from "./projectionEditJournal";
import type { requestProjection } from "./qrProjectionApi";

export interface ProjectionEditSourceOperations {
    valid: () => boolean;
    save: (record: ProjectionEditJournal) => Promise<ProjectionEditJournal>;
    edit: (link: QrProjectionLink, request: ProjectionEditRequest) => Promise<ProjectionEditDocument>;
    project: (link: QrProjectionLink, request: Parameters<typeof requestProjection>[0]) => Promise<ProjectionResponse>;
}
const requireCurrent = (ops: ProjectionEditSourceOperations) => { if (!ops.valid()) throw new Error("projection_source_unavailable"); };

export async function ensureProjectionEditSource(record: ProjectionEditJournal, link: QrProjectionLink,
    response: ProjectionResponse, ops: ProjectionEditSourceOperations): Promise<ProjectionEditJournal> {
    if (!record.source) throw new Error("projection_source_unavailable");
    if (!record.source.anchor) record = await ops.save({ ...record, source: { ...record.source, anchor: link } });
    const source = record.source!;
    const ensureBasis = async (target: QrProjectionLink, current: ProjectionResponse) => {
        requireCurrent(ops);
        if (!current.editing) {
            // Probe the editing endpoint before replacing a flattened legacy PNG.
            // Only its explicit empty-session result establishes capability.
            try { current = { ...current, editing: await ops.edit(target, { operation: "read", projectionId: target.envelope.projectionId }) }; }
            catch (error) { if (!(error instanceof Error) || error.message !== "projection_edit_not_found") throw error; }
            requireCurrent(ops);
        }
        if (current.editing) {
            if (current.editing.sessionId !== record.sessionId || current.editing.basis.digest !== source.frame.digest) throw new Error("projection_edit_session_mismatch");
            return current;
        }
        if (current.digest !== source.frame.digest) {
            current = await ops.project(target, { kind: "update", projectionId: target.envelope.projectionId,
                sourceSessionId: target.envelope.source.sessionId, priorRevision: current.revision,
                revision: current.revision + 1, snapshot: source.frame.snapshot });
        }
        requireCurrent(ops);
        if (current.digest !== source.frame.digest) throw new Error("projection_edit_basis_conflict");
        return current;
    };
    let initialized: string | undefined;
    if (!record.document) {
        const anchor = source.anchor!;
        const current = await ensureBasis(anchor, anchor.envelope.projectionId === link.envelope.projectionId ? response
            : await ops.project(anchor, { kind: "read", projectionId: anchor.envelope.projectionId, knownRevision: 0 }));
        const document = current.editing ?? await ops.edit(anchor, { operation: "initialize", projectionId: anchor.envelope.projectionId,
            sessionId: record.sessionId, expectedDigest: source.frame.digest, objects: source.initial });
        requireCurrent(ops);
        record = await ops.save({ ...record, document });
        initialized = anchor.envelope.projectionId;
    }
    if (initialized !== link.envelope.projectionId && !response.editing) {
        const current = await ensureBasis(link, response);
        requireCurrent(ops);
        const document = current.editing ?? await ops.edit(link, { operation: "attach", projectionId: link.envelope.projectionId, sessionId: record.sessionId });
        requireCurrent(ops);
        if (document.sessionId !== record.sessionId || document.basis.digest !== source.frame.digest) throw new Error("projection_edit_session_mismatch");
        // Attaching a binding does not advance the local observation baseline.
        // The next read merges its document before any local edit can use that revision.
    }
    return record;
}
