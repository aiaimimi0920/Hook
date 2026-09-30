import type { Unit } from "../types/unit";
import { parseProjectionInvitation } from "./qrProjectionProtocol";

export function recognizedProjectionInvitations(units: readonly Unit[]): string[] {
    const invitations = new Set<string>();
    for (const unit of units) {
        for (const attachment of unit.data.extensionState?.attachments ?? []) {
            if (attachment.pluginId !== "neuro.official/ocr" || attachment.typeId !== "neuro.official/ocr.codes.v1") continue;
            const payload = attachment.payload;
            if (!payload || typeof payload !== "object" || !("results" in payload) || !Array.isArray(payload.results)) continue;
            for (const result of payload.results) {
                if (!result || typeof result !== "object" || !("text" in result) || typeof result.text !== "string") continue;
                try {
                    const envelope = parseProjectionInvitation(result.text);
                    invitations.add(JSON.stringify(envelope));
                    if (invitations.size >= 8) return [...invitations];
                } catch { /* Other recognized QR payloads are not projection invitations. */ }
            }
        }
    }
    return [...invitations];
}
