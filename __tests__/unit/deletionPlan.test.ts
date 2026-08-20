import { describe, expect, it } from "vitest";

import { resolveDeletionPlan } from "../../src/services/deletionPlan";
import type { StickerAnnotationState } from "../../src/types/stickerEditing";
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

const emptyAnnotationState = (): StickerAnnotationState => ({
    serialCounter: 0,
    elements: [],
});

const stickerWithAnnotation = (id: string): Unit =>
    mkUnit({ id, type: "sticker", data: { annotationState: emptyAnnotationState() } });

describe("resolveDeletionPlan", () => {
    it("1. deletes just the annotation when a sticker annotation is selected on an annotated sticker", () => {
        const plan = resolveDeletionPlan({
            selectedAnnotationId: "anno-1",
            selectedStickerId: "s1",
            selectedUnitIds: [],
            units: [stickerWithAnnotation("s1")],
        });
        expect(plan).toEqual({ kind: "annotation", unitId: "s1", annotationIds: ["anno-1"] });
    });

    it("2. deletes just the annotation when an annotated Art node owns the selection", () => {
        const plan = resolveDeletionPlan({
            selectedAnnotationId: "anno-1",
            selectedStickerId: "a1",
            selectedUnitIds: [],
            units: [mkUnit({
                id: "a1",
                type: "art",
                data: { annotationState: emptyAnnotationState() },
            })],
        });
        expect(plan).toEqual({ kind: "annotation", unitId: "a1", annotationIds: ["anno-1"] });
    });

    it("3. falls through to unit deletion when the sticker has no annotation layer", () => {
        const plan = resolveDeletionPlan({
            selectedAnnotationId: "anno-1",
            selectedStickerId: "s1",
            selectedUnitIds: [],
            units: [mkUnit({ id: "s1", type: "sticker", data: {} })],
        });
        expect(plan).toEqual({ kind: "units", unitIds: ["s1"] });
    });

    it("4. deletes the multi-selection when present", () => {
        const plan = resolveDeletionPlan({
            selectedAnnotationId: null,
            selectedStickerId: null,
            selectedUnitIds: ["a", "b", "c"],
            units: [],
        });
        expect(plan).toEqual({ kind: "units", unitIds: ["a", "b", "c"] });
    });

    it("5. falls back to the single selected sticker when there is no multi-selection", () => {
        const plan = resolveDeletionPlan({
            selectedAnnotationId: null,
            selectedStickerId: "s1",
            selectedUnitIds: [],
            units: [mkUnit({ id: "s1" })],
        });
        expect(plan).toEqual({ kind: "units", unitIds: ["s1"] });
    });

    it("6. returns none when nothing is selected", () => {
        const plan = resolveDeletionPlan({
            selectedAnnotationId: null,
            selectedStickerId: null,
            selectedUnitIds: [],
            units: [],
        });
        expect(plan).toEqual({ kind: "none" });
    });

    it("7. returns none when only an annotation id is set (no sticker, nothing else)", () => {
        const plan = resolveDeletionPlan({
            selectedAnnotationId: "anno-1",
            selectedStickerId: null,
            selectedUnitIds: [],
            units: [],
        });
        expect(plan).toEqual({ kind: "none" });
    });

    it("8. prefers the multi-selection over the single selected sticker", () => {
        const plan = resolveDeletionPlan({
            selectedAnnotationId: null,
            selectedStickerId: "c",
            selectedUnitIds: ["a", "b"],
            units: [],
        });
        expect(plan).toEqual({ kind: "units", unitIds: ["a", "b"] });
    });

    it("9. annotation deletion takes precedence even when units are also selected", () => {
        const plan = resolveDeletionPlan({
            selectedAnnotationId: "anno-1",
            selectedStickerId: "s1",
            selectedUnitIds: ["x", "y"],
            units: [stickerWithAnnotation("s1")],
        });
        expect(plan).toEqual({ kind: "annotation", unitId: "s1", annotationIds: ["anno-1"] });
    });

    it("10. deletes every selected annotation once before considering selected units", () => {
        const selectedAnnotationIds = ["anno-1", "anno-2", "anno-1"];
        const plan = resolveDeletionPlan({
            selectedAnnotationId: "anno-2",
            selectedAnnotationIds,
            selectedStickerId: "a1",
            selectedUnitIds: ["other-unit"],
            units: [mkUnit({
                id: "a1",
                type: "art",
                data: { annotationState: emptyAnnotationState() },
            })],
        });

        expect(plan).toEqual({
            kind: "annotation",
            unitId: "a1",
            annotationIds: ["anno-1", "anno-2"],
        });
        if (plan.kind === "annotation") {
            expect(plan.annotationIds).not.toBe(selectedAnnotationIds);
        }
    });

    it("11. copies the selected unit ids rather than aliasing the input array", () => {
        const selectedUnitIds = ["a", "b"];
        const plan = resolveDeletionPlan({
            selectedAnnotationId: null,
            selectedStickerId: null,
            selectedUnitIds,
            units: [],
        });
        expect(plan.kind).toBe("units");
        if (plan.kind === "units") {
            expect(plan.unitIds).not.toBe(selectedUnitIds);
            expect(plan.unitIds).toEqual(["a", "b"]);
        }
    });
});
