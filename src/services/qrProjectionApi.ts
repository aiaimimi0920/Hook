import type { OfflineProjectionTransport, OfflineProjectionTarget, ProjectionAccountContext, ProjectionEnvelope, ProjectionOperation, ProjectionProtocol, ProjectionResponse } from "../types/qrProjection";
import { projectionInvoke } from "./projectionInvoke";
import { forgetPreparedProjection } from "./projectionCreateJournal";
import { parseProjectionEnvelope, parseProjectionResponse, parseOfflineTransport, projectionOrigin } from "./qrProjectionProtocol";

type ContentOperation = Exclude<ProjectionOperation, { kind: "context" | "code" | "unlink" | "prepare_create" }>;
const invoke = async (operation: ProjectionOperation, serverOrigin?: string, protocol: ProjectionProtocol = "neuro.qr-projection.v1", offlineRoute?: Partial<OfflineProjectionTarget>) => {
    const version = "envelope" in operation ? operation.envelope.protocol : protocol;
    if (offlineRoute && version !== "neuro.qr-projection.v1") throw new Error("projection_invalid_request");
    return version === "neuro.qr-projection.v2"
        ? projectionInvoke("projection_v2_request", { operation })
        : projectionInvoke("projection_request", { operation, serverOrigin, ...(offlineRoute ? { offlineRoute } : {}) });
};

export const requestProjection = async (operation: ContentOperation, serverOrigin?: string, protocol?: ProjectionProtocol,
    offlineTransport?: OfflineProjectionTransport, target?: OfflineProjectionTarget): Promise<ProjectionResponse> => {
    const route = offlineTransport ? parseOfflineTransport(offlineTransport) : undefined;
    const result = parseProjectionResponse(await invoke(operation, route?.origin ?? serverOrigin, protocol, route ? (target ?? {}) : undefined));
    return route ? { ...result, offlineTransport: route } : result;
};

export async function prepareProjectionCreate(operation: Extract<ProjectionOperation, { kind: "prepare_create" }>, origin: string): Promise<ProjectionEnvelope> {
    const value = await invoke(operation, projectionOrigin(origin));
    if (!value || typeof value !== "object" || !("envelope" in value)) throw new Error("projection_invalid_response");
    const envelope = parseProjectionEnvelope(value.envelope);
    if (envelope.protocol !== "neuro.qr-projection.v1" || envelope.serverOrigin !== origin || envelope.source.unitId !== operation.unitId) {
        throw new Error("projection_invalid_response");
    }
    return envelope;
}

export async function projectionAccountContext(): Promise<ProjectionAccountContext> {
    const value = await invoke({ kind: "context" }, undefined, "neuro.qr-projection.v2");
    if (!value || typeof value !== "object" || !("status" in value) || value.status !== "signed_in"
        || !("origin" in value) || typeof value.origin !== "string" || !("accountId" in value) || typeof value.accountId !== "string"
        || !("deviceId" in value) || typeof value.deviceId !== "string" || !("deviceName" in value) || typeof value.deviceName !== "string") {
        throw new Error("projection_invalid_response");
    }
    return { origin: projectionOrigin(value.origin), accountId: value.accountId, deviceId: value.deviceId, deviceName: value.deviceName };
}

export async function projectionContext(): Promise<string> {
    const result = await invoke({ kind: "context" });
    if (!result || typeof result !== "object" || !("serverOrigin" in result) || typeof result.serverOrigin !== "string") {
        throw new Error("projection_invalid_response");
    }
    return projectionOrigin(result.serverOrigin);
}

export async function projectionCode(envelope: ProjectionEnvelope): Promise<string> {
    const result = await invoke({ kind: "code", envelope });
    if (!result || typeof result !== "object" || !("qrDataUrl" in result) || typeof result.qrDataUrl !== "string"
        || !result.qrDataUrl.startsWith("data:image/svg+xml;base64,")) throw new Error("projection_invalid_response");
    return result.qrDataUrl;
}

export async function unlinkProjection(projectionId: string, serverOrigin: string, protocol?: ProjectionProtocol, offlineTransport?: OfflineProjectionTransport): Promise<void> {
    const route = offlineTransport ? parseOfflineTransport(offlineTransport) : undefined;
    const result = await invoke({ kind: "unlink", projectionId }, route?.origin ?? serverOrigin, protocol, route ? {} : undefined);
    if (!result || typeof result !== "object" || !("unlinked" in result) || result.unlinked !== true) {
        throw new Error("projection_invalid_response");
    }
    if (!protocol || protocol === "neuro.qr-projection.v1") await forgetPreparedProjection(route?.origin ?? serverOrigin, projectionId);
}
