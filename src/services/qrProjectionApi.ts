import type { ProjectionAccountContext, ProjectionEnvelope, ProjectionOperation, ProjectionProtocol, ProjectionResponse } from "../types/qrProjection";
import { safeInvoke } from "./apiTransport";
import { parseProjectionResponse, projectionOrigin } from "./qrProjectionProtocol";

type ContentOperation = Exclude<ProjectionOperation, { kind: "context" | "code" | "unlink" }>;
const invoke = (operation: ProjectionOperation, serverOrigin?: string, protocol: ProjectionProtocol = "neuro.qr-projection.v1") => {
    const version = "envelope" in operation ? operation.envelope.protocol : protocol;
    return version === "neuro.qr-projection.v2"
        ? safeInvoke<unknown>("projection_v2_request", { operation })
        : safeInvoke<unknown>("projection_request", { operation, serverOrigin });
};

export const requestProjection = async (operation: ContentOperation, serverOrigin?: string, protocol?: ProjectionProtocol): Promise<ProjectionResponse> =>
    parseProjectionResponse(await invoke(operation, serverOrigin, protocol));

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

export async function unlinkProjection(projectionId: string, serverOrigin: string, protocol?: ProjectionProtocol): Promise<void> {
    const result = await invoke({ kind: "unlink", projectionId }, serverOrigin, protocol);
    if (!result || typeof result !== "object" || !("unlinked" in result) || result.unlinked !== true) {
        throw new Error("projection_invalid_response");
    }
}
