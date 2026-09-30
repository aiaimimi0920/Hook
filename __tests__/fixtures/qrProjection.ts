import type { ProjectionEnvelope, ProjectionResponse } from "../../src/types/qrProjection";
import type { Unit } from "../../src/types/unit";

export const projectionEnvelope = (): ProjectionEnvelope => ({
    protocol: "neuro.qr-projection.v1", projectionId: `projection:${"1".repeat(32)}`, serverOrigin: "https://loom.example.test",
    source: { deviceId: "device-a", sessionId: "session-a", unitId: "source", revision: 1 },
    content: { kind: "sticker", digest: "a".repeat(64) }, expiresAtMs: 9_000_000, nonce: "2".repeat(32),
    signature: { algorithm: "ed25519", keyId: "device-a", value: "A".repeat(86) },
});
export const projectionEnvelopeV2 = (): Extract<ProjectionEnvelope, { protocol: "neuro.qr-projection.v2" }> => ({
    ...projectionEnvelope(), protocol: "neuro.qr-projection.v2",
    source: { ...projectionEnvelope().source, deviceId: "148946ee-b1af-4114-ae78-fae086f12068",
        accountId: "account:test", publicKey: btoa("a".repeat(32)) },
    signature: { algorithm: "ed25519", keyId: "148946ee-b1af-4114-ae78-fae086f12068", value: "A".repeat(86) },
});
export const projectionResponse = (revision = 1, pixel = "a"): ProjectionResponse => ({
    envelope: projectionEnvelope(), revision, digest: pixel.repeat(64), linked: true,
    receiverDeviceId: "device-b", receiverUnitId: "receiver", snapshot: { imageBase64: btoa(pixel), width: 1, height: 1 },
});
export const projectionUnit = (role: "source" | "receiver" = "source"): Unit => ({
    id: role, type: "sticker", x: 40, y: 60, w: 120, h: 100, params: {}, inputs: [], outputs: [],
    data: { src: "a", opacityNormal: 0.5, qrProjection: { role, localUnitId: role, envelope: projectionEnvelope(),
        revision: 1, digest: "a".repeat(64), linked: true } },
});
