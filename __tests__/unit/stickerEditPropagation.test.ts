import { describe, expect, it } from "vitest";
import {
  buildStickerEditPropagationPatches,
  markStickerEditPropagationLocally,
} from "../../src/services/stickerEditPropagation";
import type { Link, Unit } from "../../src/types/unit";

const sticker = (id: string, frame: Pick<Unit, "w" | "h">, data: Unit["data"] = {}): Unit => ({
  id,
  type: "sticker",
  x: 0,
  y: 0,
  w: frame.w,
  h: frame.h,
  params: {},
  inputs: [{ id: "image", type: "image", direction: "input", label: "Image" }],
  outputs: [{ id: "output", type: "image", direction: "output", label: "Image" }],
  data,
});

const link = (fromUnitId: string, toUnitId: string): Link => ({
  id: `${fromUnitId}-${toUnitId}`,
  fromUnitId,
  fromPortId: "output",
  toUnitId,
  toPortId: "image",
});

describe("sticker edit propagation", () => {
  it("propagates annotation edits through sticker chains using the same contained image mapping as linked stickers", () => {
    const units: Unit[] = [
      sticker("a", { w: 100, h: 100 }, {
        annotationState: {
          serialCounter: 1,
          elements: [
            {
              id: "rect-a",
              type: "rect",
              zIndex: 1,
              x: 10,
              y: 20,
              w: 30,
              h: 40,
              style: { color: "#fff", width: 2, opacity: 1 },
            },
            {
              id: "line-a",
              type: "line",
              zIndex: 2,
              points: [
                { x: 0, y: 50 },
                { x: 100, y: 50 },
              ],
              style: { color: "#fff", width: 4, opacity: 1 },
            },
            {
              id: "text-a",
              type: "text",
              zIndex: 3,
              x: 50,
              y: 10,
              text: "A",
              fontSize: 12,
              style: { color: "#fff", width: 1, opacity: 1 },
            },
          ],
        },
        imageEditState: {
          contentEraseStrokes: [
            {
              id: "erase-a",
              points: [
                { x: 25, y: 25 },
                { x: 75, y: 75 },
              ],
              color: "#000",
              width: 10,
              opacity: 1,
            },
          ],
          borderWidth: 6,
          borderColor: "#fff",
          cornerRadius: 12,
        },
      }),
      sticker("b", { w: 200, h: 100 }),
      sticker("c", { w: 400, h: 200 }),
    ];

    const patches = buildStickerEditPropagationPatches({
      units,
      links: [link("a", "b"), link("b", "c")],
      sourceUnitId: "a",
    });

    expect(patches.map((patch) => patch.unitId)).toEqual(["b", "c"]);
    expect(patches[0].data.annotationState?.elements[0]).toMatchObject({
      id: "rect-a",
      x: 60,
      y: 20,
      w: 30,
      h: 40,
    });
    expect(patches[0].data.annotationState?.elements[1]).toMatchObject({
      id: "line-a",
      points: [
        { x: 50, y: 50 },
        { x: 150, y: 50 },
      ],
      style: { width: 4 },
    });
    expect(patches[0].data.annotationState?.elements[2]).toMatchObject({
      id: "text-a",
      x: 100,
      y: 10,
      fontSize: 12,
    });
    expect(patches[0].data.imageEditState?.contentEraseStrokes[0]).toMatchObject({
      points: [
        { x: 75, y: 25 },
        { x: 125, y: 75 },
      ],
      width: 10,
    });
    expect(patches[0].data.imageEditState).toMatchObject({
      borderWidth: 6,
      borderColor: "#fff",
      cornerRadius: 12,
    });
    expect(patches[1].data.annotationState?.elements[0]).toMatchObject({
      id: "rect-a",
      x: 120,
      y: 40,
      w: 60,
      h: 80,
    });
    expect(patches[1].data.imageEditState?.contentEraseStrokes[0]).toMatchObject({
      points: [
        { x: 150, y: 50 },
        { x: 250, y: 150 },
      ],
      width: 20,
    });
  });

  it("clips source brush and content eraser strokes before mapping them into a wider downstream sticker", () => {
    const patches = buildStickerEditPropagationPatches({
      units: [
        sticker("a", { w: 100, h: 100 }, {
          annotationState: {
            serialCounter: 1,
            elements: [
              {
                id: "brush-a",
                type: "brush",
                zIndex: 1,
                points: [
                  { x: -25, y: 50 },
                  { x: 50, y: 50 },
                  { x: 125, y: 50 },
                ],
                style: { color: "#fff", width: 4, opacity: 1 },
              },
            ],
          },
          imageEditState: {
            contentEraseStrokes: [
              {
                id: "erase-a",
                points: [
                  { x: 50, y: -25 },
                  { x: 50, y: 50 },
                  { x: 50, y: 125 },
                ],
                color: "#000",
                width: 8,
                opacity: 1,
              },
            ],
          },
        }),
        sticker("b", { w: 200, h: 100 }),
      ],
      links: [link("a", "b")],
      sourceUnitId: "a",
    });

    expect(patches).toHaveLength(1);
    expect(patches[0].data.annotationState?.elements[0]).toMatchObject({
      id: "brush-a",
      points: [
        { x: 50, y: 50 },
        { x: 100, y: 50 },
        { x: 150, y: 50 },
      ],
    });
    expect(patches[0].data.imageEditState?.contentEraseStrokes[0]).toMatchObject({
      id: "erase-a",
      points: [
        { x: 100, y: 0 },
        { x: 100, y: 50 },
        { x: 100, y: 100 },
      ],
    });
  });

  it("stops at a sticker that explicitly rejects upstream edit propagation", () => {
    const patches = buildStickerEditPropagationPatches({
      units: [
        sticker("a", { w: 100, h: 100 }, {
          annotationState: { serialCounter: 1, elements: [] },
        }),
        sticker("b", { w: 100, h: 100 }, {
          stickerEditPropagation: { acceptUpstream: false },
        }),
        sticker("c", { w: 100, h: 100 }),
      ],
      links: [link("a", "b"), link("b", "c")],
      sourceUnitId: "a",
    });

    expect(patches).toEqual([]);
  });

  it("stops at a sticker that has already been manually edited", () => {
    const patches = buildStickerEditPropagationPatches({
      units: [
        sticker("a", { w: 100, h: 100 }, {
          annotationState: { serialCounter: 1, elements: [] },
        }),
        sticker("b", { w: 100, h: 100 }, {
          stickerEditPropagation: { acceptUpstream: true, locallyEdited: true },
        }),
        sticker("c", { w: 100, h: 100 }),
      ],
      links: [link("a", "b"), link("b", "c")],
      sourceUnitId: "a",
    });

    expect(patches).toEqual([]);
  });

  it("marks manual edits as local ownership while preserving the user's upstream acceptance choice", () => {
    expect(
      markStickerEditPropagationLocally({
        acceptUpstream: false,
        revision: 3,
        upstreamSourceUnitId: "a",
      }),
    ).toEqual({
      acceptUpstream: false,
      locallyEdited: true,
      revision: 4,
      upstreamSourceUnitId: "a",
    });
  });
});
