// Pure text builders for Tea work-order tickets.
//
// Extracted from app.tsx's summarizeSelectedUnitsForTea / buildTeaTicketText so
// the exact ticket wording and per-unit summary format can be characterized by
// tests. The reactive selection reads and store access stay in app.tsx, which
// resolves the inputs and calls these pure functions.

import type { Unit } from "../types/unit";

/**
 * One space-delimited summary line per selected unit (id/type/art/origin), joined
 * by newlines. Returns "" when nothing is selected. Units not in `selectedIds`
 * are skipped.
 */
export const summarizeUnitsForTea = (
    units: readonly Unit[],
    selectedIds: readonly string[],
): string => {
    if (selectedIds.length === 0) return "";

    const idSet = new Set(selectedIds);
    return units
        .filter((unit) => idSet.has(unit.id))
        .map((unit) =>
            [
                `id=${unit.id}`,
                `type=${unit.type}`,
                `art=${unit.artId || "none"}`,
                `originWorkflow=${unit.data?.originWorkflowId || "none"}`,
                `originNode=${unit.data?.originNodeId || "none"}`,
            ].join(" "),
        )
        .join("\n");
};

export interface TeaTicketTextInput {
    trigger: string;
    unitCount: number;
    linkCount: number;
    selectedSummary: string;
    voiceOutput: string;
}

/** Composes the full Tea ticket body from the current Hook context. */
export const composeTeaTicketText = (input: TeaTicketTextInput): string =>
    [
        `Hook desktop ticket request (${input.trigger})`,
        `units: ${input.unitCount}`,
        `links: ${input.linkCount}`,
        input.selectedSummary ? `selected_units:\n${input.selectedSummary}` : "selected_units: none",
        input.voiceOutput ? `voice_context:\n${input.voiceOutput}` : "voice_context: none",
        "requested_action: Analyze this Hook context and propose the next AI work-order plan.",
    ].join("\n");
