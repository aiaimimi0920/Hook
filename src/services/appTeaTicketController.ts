import type { Accessor, Setter } from "solid-js";

import { graphStore } from "../store/graphStore";
import { selectedStickerId, selectedUnitIds } from "../store/uiStore";
import { api, type TeaTicketSummary } from "./api";
import type { VoiceSessionPayload } from "./appCommandListeners";
import { composeTeaTicketText, summarizeUnitsForTea } from "./teaTicketText";

type AppTeaTicketControllerDependencies = {
    lastVoiceSession: Accessor<VoiceSessionPayload | null>;
    setLastTeaTicket: Setter<TeaTicketSummary | null>;
    setLastTeaTicketError: Setter<string | null>;
};

/** Builds Tea tickets from the current selection without coupling Tea to the App view. */
export function createAppTeaTicketController(
    dependencies: AppTeaTicketControllerDependencies,
) {
    const summarizeSelectedUnits = () => {
        const ids = selectedUnitIds.length > 0
            ? [...selectedUnitIds]
            : selectedStickerId()
                ? [selectedStickerId()!]
                : [];
        return summarizeUnitsForTea(graphStore.units, ids);
    };

    const buildTicketText = (trigger: string) =>
        composeTeaTicketText({
            trigger,
            unitCount: graphStore.units.length,
            linkCount: graphStore.links.length,
            selectedSummary: summarizeSelectedUnits(),
            voiceOutput:
                dependencies.lastVoiceSession()?.outputText
                || dependencies.lastVoiceSession()?.transcript
                || "",
        });

    const createTeaTicketFromCurrentHookState = async (trigger = "panel") => {
        const selectedSummary = summarizeSelectedUnits();
        const voiceOutput =
            dependencies.lastVoiceSession()?.outputText
            || dependencies.lastVoiceSession()?.transcript
            || null;
        dependencies.setLastTeaTicketError(null);

        try {
            const ticket = await api.createTeaTicket({
                source: "hook-desktop",
                text: buildTicketText(trigger),
                context: {
                    active_window: null,
                    selection_text: selectedSummary || voiceOutput,
                    ocr_text: dependencies.lastVoiceSession()?.transcript || null,
                    screenshot_ref: null,
                    cwd: null,
                    app: "hook",
                },
                attachments: [],
            });
            dependencies.setLastTeaTicket(ticket);
            void api.debugLogEvent("tea-ticket-created", `id=${ticket.id} status=${ticket.status}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            dependencies.setLastTeaTicketError(message);
            void api.debugLogEvent("tea-ticket-create-failed", message);
        }
    };

    return { createTeaTicketFromCurrentHookState };
}
