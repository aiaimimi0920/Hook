import { describe, expect, it } from "vitest";
import { createStore } from "solid-js/store";
import {
  cloneStickerAnnotation,
  getAnnotationCenter,
  getAnnotationGroupCenter,
  rotateAnnotationsAroundGroupCenter,
  rotateAnnotationsAroundOwnCenters,
  scaleAnnotationsAroundGroupCenter,
  scaleAnnotationsAroundOwnCenters,
  translateAnnotation,
} from "../../src/services/stickerGeometry";
import type { StickerAnnotation, StickerShapeAnnotation } from "../../src/types/stickerEditing";

describe("sticker edit transforms: geometry operations", () => {
  it("clones store-backed annotations before transform interactions snapshot their baseline", () => {
    const [state] = createStore<{ elements: StickerShapeAnnotation[] }>({
      elements: [
        {
          id: "rect",
          type: "rect",
          zIndex: 1,
          x: 10,
          y: 20,
          w: 30,
          h: 40,
          style: { color: "#fff", width: 2, opacity: 1, fill: "transparent" },
        },
      ],
    });

    const cloned = cloneStickerAnnotation(state.elements[0]);
    expect(cloned).toEqual({
      id: "rect",
      type: "rect",
      zIndex: 1,
      x: 10,
      y: 20,
      w: 30,
      h: 40,
      style: { color: "#fff", width: 2, opacity: 1, fill: "transparent" },
    });
    expect(cloned).not.toBe(state.elements[0]);

    cloned.x = 99;
    expect(state.elements[0].x).toBe(10);
  });

  it("uses the overall group center by default for multi-annotation rotate and scale transforms", () => {
    const annotations: StickerAnnotation[] = [
      {
        id: "left",
        type: "rect",
        zIndex: 1,
        x: 0,
        y: 0,
        w: 20,
        h: 20,
        style: { color: "#fff", width: 2, opacity: 1 },
      },
      {
        id: "right",
        type: "rect",
        zIndex: 2,
        x: 40,
        y: 0,
        w: 20,
        h: 20,
        style: { color: "#fff", width: 2, opacity: 1 },
      },
    ];

    expect(getAnnotationCenter(annotations[0])).toEqual({ x: 10, y: 10 });
    expect(getAnnotationCenter(annotations[1])).toEqual({ x: 50, y: 10 });
    expect(getAnnotationGroupCenter(annotations)).toEqual({ x: 30, y: 10 });

    const rotated = rotateAnnotationsAroundGroupCenter(annotations, 90);
    expect(getAnnotationCenter(rotated[0])).toEqual({ x: 30, y: -10 });
    expect(getAnnotationCenter(rotated[1])).toEqual({ x: 30, y: 30 });

    const scaled = scaleAnnotationsAroundGroupCenter(annotations, { x: 2, y: 2 });
    expect(getAnnotationCenter(scaled[0])).toEqual({ x: -10, y: 10 });
    expect(getAnnotationCenter(scaled[1])).toEqual({ x: 70, y: 10 });
  });

  it("switches to per-node centers for multi-annotation rotate and scale transforms when requested", () => {
    const annotations: StickerAnnotation[] = [
      {
        id: "left",
        type: "rect",
        zIndex: 1,
        x: 0,
        y: 0,
        w: 20,
        h: 20,
        style: { color: "#fff", width: 2, opacity: 1 },
      },
      {
        id: "right",
        type: "rect",
        zIndex: 2,
        x: 40,
        y: 0,
        w: 20,
        h: 20,
        style: { color: "#fff", width: 2, opacity: 1 },
      },
    ];

    const rotated = rotateAnnotationsAroundOwnCenters(annotations, 90);
    expect(getAnnotationCenter(rotated[0])).toEqual({ x: 10, y: 10 });
    expect(getAnnotationCenter(rotated[1])).toEqual({ x: 50, y: 10 });

    const scaled = scaleAnnotationsAroundOwnCenters(annotations, { x: 2, y: 2 });
    expect(getAnnotationCenter(scaled[0])).toEqual({ x: 10, y: 10 });
    expect(getAnnotationCenter(scaled[1])).toEqual({ x: 50, y: 10 });
    expect(scaled[0]).toMatchObject({ x: -10, y: -10, w: 40, h: 40 });
    expect(scaled[1]).toMatchObject({ x: 30, y: -10, w: 40, h: 40 });
  });

  it("rotates brush-style effect annotations as a whole, including stroke points and bounds", () => {
    const annotations: StickerAnnotation[] = [
      {
        id: "effect",
        type: "mosaic",
        zIndex: 1,
        x: 10,
        y: 10,
        w: 40,
        h: 20,
        points: [
          { x: 20, y: 20 },
          { x: 40, y: 20 },
        ],
        brushWidth: 10,
        strength: 12,
        style: {
          color: "#fff",
          width: 0,
          opacity: 1,
          fill: "#000",
          secondaryFill: "#fff",
        },
      },
    ];

    const rotated = rotateAnnotationsAroundOwnCenters(annotations, 90);
    expect(rotated[0]).toMatchObject({
      x: 25,
      y: 5,
      w: 10,
      h: 30,
      points: [
        { x: 30, y: 10 },
        { x: 30, y: 30 },
      ],
    });
  });

  it("translates triangle and polygon annotations when move transforms are applied", () => {
    const triangle = translateAnnotation(
      {
        id: "triangle",
        type: "triangle",
        zIndex: 1,
        x: 10,
        y: 20,
        w: 30,
        h: 40,
        style: { color: "#fff", width: 2, opacity: 1 },
      },
      12,
      -6,
    );

    const polygon = translateAnnotation(
      {
        id: "polygon",
        type: "polygon",
        zIndex: 2,
        x: 50,
        y: 60,
        w: 20,
        h: 20,
        sides: 6,
        style: { color: "#fff", width: 2, opacity: 1 },
      },
      -8,
      14,
    );

    expect(triangle).toMatchObject({ x: 22, y: 14, w: 30, h: 40 });
    expect(polygon).toMatchObject({ x: 42, y: 74, w: 20, h: 20, sides: 6 });
  });

});
