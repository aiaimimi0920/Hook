/** Only this metadata is persisted; authentication credentials remain in the native host. */
interface ProjectionEnvelopeFields {
    projectionId: string;
    serverOrigin: string;
    content: { kind: "sticker" | "art"; digest: string };
    expiresAtMs: number;
    nonce: string;
    signature: { algorithm: "ed25519"; keyId: string; value: string };
}
type ProjectionSource = { deviceId: string; sessionId: string; unitId: string; revision: number };
export type ProjectionEnvelope = ProjectionEnvelopeFields & (
    | { protocol: "neuro.qr-projection.v1"; source: ProjectionSource }
    | { protocol: "neuro.qr-projection.v2"; source: ProjectionSource & { accountId: string; publicKey: string } }
);
export type ProjectionProtocol = ProjectionEnvelope["protocol"];
export interface ProjectionAccountContext { origin: string; accountId: string; deviceId: string; deviceName: string }

export interface ProjectionSnapshot { imageBase64: string; width: number; height: number }
export interface OfflineProjectionTransport { origin: string }
export interface OfflineProjectionTarget { peerId: string; remoteDeviceId: string }
export interface ProjectionResponse {
    editing?: import("./projectionEdit").ProjectionEditDocument;
    offlineTransport?: OfflineProjectionTransport;
    envelope: ProjectionEnvelope;
    revision: number;
    digest: string;
    linked: boolean;
    receiverDeviceId: string | null;
    receiverUnitId: string | null;
    snapshot?: ProjectionSnapshot | null;
    sourceName?: string;
    qrDataUrl?: string;
    transport?: "direct" | "relay" | "offline" | "reconnecting";
    error?: string;
    delivery?: { targetDeviceId: string; status: "awaiting_confirmation" | "accepted" | "displayed" | "rejected" } | null;
}

export interface QrProjectionLink {
    sourceName?: string;
    offlineTransport?: OfflineProjectionTransport;
    role: "source" | "receiver";
    localUnitId: string;
    envelope: ProjectionEnvelope;
    revision: number;
    digest: string;
    linked: boolean;
    stopPending?: boolean;
    stopped?: boolean;
    stopReason?: string;
}

export type ProjectionOperation =
    | { kind: "context" }
    | { kind: "create"; unitId: string; contentKind: "sticker" | "art"; snapshot: ProjectionSnapshot; targetDeviceId?: string }
    | { kind: "prepare_create"; unitId: string; contentKind: "sticker" | "art"; snapshot: ProjectionSnapshot; targetDeviceId?: string }
    | { kind: "create_prepared"; envelope: ProjectionEnvelope; snapshot: ProjectionSnapshot; targetDeviceId?: string }
    | { kind: "inspect"; envelope: ProjectionEnvelope }
    | { kind: "accept"; envelope: ProjectionEnvelope; expectedRevision: number; expectedDigest: string; receiverUnitId: string; confirmed: true }
    | { kind: "update"; projectionId: string; sourceSessionId: string; priorRevision: number; revision: number; snapshot: ProjectionSnapshot }
    | { kind: "read"; projectionId: string; knownRevision: number }
    | { kind: "unlink"; projectionId: string }
    | { kind: "code"; envelope: ProjectionEnvelope };
