import type { ProjectionEnvelope } from "../types/qrProjection";

const PREFIX = "hook://projection/v1#";
export const MAX_PROJECTION_INVITATION_TEXT = 8192;
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");

/** Self-contained invitation, never a URL to fetch or an administrator credential. */
export function projectionInvitationLink(envelope: ProjectionEnvelope): string {
    const text = JSON.stringify(envelope);
    if (text.length > 4096) throw new Error("projection_invalid_invitation");
    return PREFIX + base64url(new TextEncoder().encode(text));
}

export function unwrapProjectionInvitation(text: string): string {
    if (text.length > MAX_PROJECTION_INVITATION_TEXT) throw new Error("projection_invalid_invitation");
    if (!text.startsWith(PREFIX)) return text;
    const payload = text.slice(PREFIX.length);
    if (!/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error("projection_invalid_invitation");
    const binary = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (base64url(bytes) !== payload) throw new Error("projection_invalid_invitation");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
