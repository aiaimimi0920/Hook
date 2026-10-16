import type { QrProjectionLink } from "../types/qrProjection";
import type { ProjectionEditRequest } from "../types/projectionEdit";
import { projectionInvoke } from "./projectionInvoke";
import { projectionOrigin } from "./qrProjectionProtocol";
import { parseProjectionEditDocument, parseProjectionEditRequest } from "./projectionEditProtocol";

export async function requestProjectionEdit(link: QrProjectionLink, request: ProjectionEditRequest) {
    if (link.envelope.protocol !== "neuro.qr-projection.v1" || link.envelope.projectionId !== request.projectionId) throw new Error("projection_invalid_request");
    const value = await projectionInvoke("projection_request", {
        operation: { kind: "edit", request: parseProjectionEditRequest(request) },
        serverOrigin: projectionOrigin(link.offlineTransport?.origin ?? link.envelope.serverOrigin),
        ...(link.offlineTransport ? { offlineRoute: {} } : {}),
    });
    const document = parseProjectionEditDocument(value);
    if ("sessionId" in request && request.sessionId !== document.sessionId) throw new Error("projection_edit_session_mismatch");
    return document;
}
