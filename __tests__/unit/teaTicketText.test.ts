import { describe, expect, it } from "vitest";

import { composeTeaTicketText, summarizeUnitsForTea } from "../../src/services/teaTicketText";
import type { Unit } from "../../src/types/unit";

const mkUnit = (over: Partial<Unit> & { id: string }): Unit => ({
    type: "sticker",
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    params: {},
    inputs: [],
    outputs: [],
    data: {},
    ...over,
});

describe("summarizeUnitsForTea", () => {
    it("returns an empty string when nothing is selected", () => {
        expect(summarizeUnitsForTea([mkUnit({ id: "a" })], [])).toBe("");
    });

    it("summarizes a fully-populated unit on one line", () => {
        const unit = mkUnit({
            id: "u1",
            type: "art",
            artId: "blur",
            data: { originWorkflowId: "wf", originNodeId: "n1" },
        });
        expect(summarizeUnitsForTea([unit], ["u1"])).toBe(
            "id=u1 type=art art=blur originWorkflow=wf originNode=n1",
        );
    });

    it("uses 'none' for missing art/origin fields", () => {
        expect(summarizeUnitsForTea([mkUnit({ id: "s" })], ["s"])).toBe(
            "id=s type=sticker art=none originWorkflow=none originNode=none",
        );
    });

    it("joins multiple selected units with newlines and skips unselected ones", () => {
        const units = [mkUnit({ id: "a" }), mkUnit({ id: "b" }), mkUnit({ id: "c" })];
        const out = summarizeUnitsForTea(units, ["a", "c"]);
        expect(out.split("\n")).toHaveLength(2);
        expect(out).toContain("id=a ");
        expect(out).toContain("id=c ");
        expect(out).not.toContain("id=b ");
    });

    it("skips selected ids that do not exist in the units list", () => {
        expect(summarizeUnitsForTea([mkUnit({ id: "a" })], ["ghost"])).toBe("");
    });
});

describe("composeTeaTicketText", () => {
    it("composes the full ticket body with all fields present", () => {
        const text = composeTeaTicketText({
            trigger: "panel",
            unitCount: 3,
            linkCount: 2,
            selectedSummary: "id=a type=sticker art=none originWorkflow=none originNode=none",
            voiceOutput: "do the thing",
        });
        expect(text).toBe(
            [
                "Hook desktop ticket request (panel)",
                "units: 3",
                "links: 2",
                "selected_units:\nid=a type=sticker art=none originWorkflow=none originNode=none",
                "voice_context:\ndo the thing",
                "requested_action: Analyze this Hook context and propose the next AI work-order plan.",
            ].join("\n"),
        );
    });

    it("emits 'selected_units: none' when the summary is empty", () => {
        const text = composeTeaTicketText({
            trigger: "shortcut",
            unitCount: 0,
            linkCount: 0,
            selectedSummary: "",
            voiceOutput: "hi",
        });
        expect(text).toContain("selected_units: none");
        expect(text).not.toContain("selected_units:\n");
    });

    it("emits 'voice_context: none' when there is no voice output", () => {
        const text = composeTeaTicketText({
            trigger: "panel",
            unitCount: 1,
            linkCount: 0,
            selectedSummary: "id=a type=sticker art=none originWorkflow=none originNode=none",
            voiceOutput: "",
        });
        expect(text).toContain("voice_context: none");
        expect(text).not.toContain("voice_context:\n");
    });

    it("interpolates the trigger and counts", () => {
        const text = composeTeaTicketText({
            trigger: "auto",
            unitCount: 42,
            linkCount: 7,
            selectedSummary: "",
            voiceOutput: "",
        });
        expect(text).toContain("Hook desktop ticket request (auto)");
        expect(text).toContain("units: 42");
        expect(text).toContain("links: 7");
    });
});
