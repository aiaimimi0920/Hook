import { expect, it } from "vitest";
import { projectionInvitationLink } from "../../src/services/projectionInvitationLink";
import { parseProjectionInvitation, parseProjectionResponse, sanitizeProjectionLink } from "../../src/services/qrProjectionProtocol";
import { projectionLinkFromResponse } from "../../src/services/qrProjectionSession";
import { projectionEnvelope, projectionEnvelopeV2, projectionResponse } from "../fixtures/qrProjection";

it.each([projectionEnvelope, projectionEnvelopeV2])("round trips a versioned link without changing signed fields", (fixture) => {
    const envelope = fixture();
    const link = projectionInvitationLink(envelope);
    expect(link.startsWith("hook://projection/v1#")).toBe(true);
    expect(parseProjectionInvitation(link)).toEqual(envelope);
    expect(parseProjectionInvitation(JSON.stringify(envelope))).toEqual(envelope);
});

it.each(["https://untrusted.test/invitation", "javascript:alert(1)", "hook://projection/v2#abc", "hook://projection/v1#%%%", "hook://projection/v1#_w", "hook://projection/v1#abc?url=https://untrusted.test"])("rejects unsupported or malformed link %s", (value) => {
    expect(() => parseProjectionInvitation(value)).toThrow("projection_invalid_invitation");
});

it("rejects oversized input before removing whitespace and retains signature validation", () => {
    expect(() => parseProjectionInvitation(JSON.stringify(projectionEnvelope()) + " ".repeat(8192))).toThrow();
    const malformed = { ...projectionEnvelope(), signature: { algorithm: "ed25519" as const, keyId: "wrong", value: "A".repeat(86) } };
    expect(() => parseProjectionInvitation(projectionInvitationLink(malformed))).toThrow();
});

it("persists bounded source display names without interpreting them as authority", () => {
    const response = { ...projectionResponse(), sourceName: "PC3 工作站" };
    const saved = projectionLinkFromResponse("receiver", "receiver", response);
    expect(sanitizeProjectionLink(saved, "receiver")?.sourceName).toBe(response.sourceName);
    expect(sanitizeProjectionLink(saved, "receiver")?.envelope.source.deviceId).toBe("device-a");
    expect(() => parseProjectionResponse({ ...response, sourceName: "x".repeat(1025) })).toThrow();
});
