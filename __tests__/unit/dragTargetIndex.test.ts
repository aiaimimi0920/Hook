import { describe, expect, it } from "vitest";

import { buildDragTargetIndex } from "../../src/services/dragTargetIndex";
import type { Unit } from "../../src/types/unit";

const unit = (id: string, x: number, y: number, w = 100, h = 100): Unit => ({
  id,
  type: "sticker",
  x,
  y,
  w,
  h,
  data: {},
  params: {},
  inputs: [],
  outputs: [],
});

describe("drag target spatial index", () => {
  it("preserves reverse canvas order for overlapping cascade targets", () => {
    const index = buildDragTargetIndex([
      unit("dragged", 0, 0),
      unit("lower", 200, 200),
      unit("upper", 220, 220),
    ], new Set(["dragged"]));

    expect(index.findCascadeTarget(230, 230).target?.id).toBe("upper");
    expect(index.findCascadeTarget(205, 205).target?.id).toBe("lower");
  });

  it("keeps very large targets queryable without populating an unbounded grid", () => {
    const index = buildDragTargetIndex([
      unit("large", -100_000, -100_000, 200_000, 200_000),
    ], new Set());

    expect(index.findCascadeTarget(75_000, 75_000).target?.id).toBe("large");
  });

  it("uses the coarse grid instead of scanning every 4K target", () => {
    const units = Array.from({ length: 500 }, (_, index) =>
      unit(`large-${index}`, index * 10_000, 0, 4_096, 4_096),
    );
    const index = buildDragTargetIndex(units, new Set());

    const query = index.findCascadeTarget(2_500_100, 100);
    expect(query.target?.id).toBe("large-250");
    expect(query.candidateCount).toBeLessThan(10);
  });

  it("returns independently ordered X and Y alignment candidates", () => {
    const index = buildDragTargetIndex([
      unit("dragged", 0, 0),
      unit("x-edge", 200, 1_000, 50, 50),
      unit("y-edge", 1_000, 300, 50, 50),
    ], new Set(["dragged"]));

    const candidates = index.findAlignmentTargets(240, 340, 100, 100, 15);
    expect(candidates.xTargets.map((target) => target.id)).toEqual(["x-edge"]);
    expect(candidates.yTargets.map((target) => target.id)).toEqual(["y-edge"]);
  });

  it("limits large-canvas queries to nearby candidates", () => {
    const units = Array.from({ length: 1_000 }, (_, index) =>
      unit(`target-${index}`, index * 1_000, index * 1_000),
    );
    const index = buildDragTargetIndex(units, new Set());

    const cascade = index.findCascadeTarget(500_050, 500_050);
    const alignment = index.findAlignmentTargets(500_090, 500_090, 100, 100, 15);

    expect(cascade.target?.id).toBe("target-500");
    expect(cascade.candidateCount).toBeLessThan(10);
    expect(alignment.xTargets.length).toBeLessThan(10);
    expect(alignment.yTargets.length).toBeLessThan(10);
  });
});
