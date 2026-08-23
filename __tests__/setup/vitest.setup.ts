// This file is a module (see the trailing `export {}`) so that the `declare
// global` block below is a legal global augmentation.
const DEFAULT_FONT_SIZE = 16;
const DEFAULT_TEXT_WIDTH_FACTOR = 0.6;

type Canvas2DContextStub = {
  canvas: HTMLCanvasElement | null;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  globalAlpha: number;
  measureText: (text: string) => TextMetrics;
  beginPath: () => void;
  closePath: () => void;
  moveTo: (x: number, y: number) => void;
  lineTo: (x: number, y: number) => void;
  quadraticCurveTo: (cpx: number, cpy: number, x: number, y: number) => void;
  bezierCurveTo: (
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ) => void;
  rect: (x: number, y: number, w: number, h: number) => void;
  roundRect: (x: number, y: number, w: number, h: number, radii?: number | number[]) => void;
  arc: (x: number, y: number, radius: number, startAngle: number, endAngle: number) => void;
  ellipse: (
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
  ) => void;
  fill: () => void;
  stroke: () => void;
  fillRect: (x: number, y: number, w: number, h: number) => void;
  strokeRect: (x: number, y: number, w: number, h: number) => void;
  clearRect: (x: number, y: number, w: number, h: number) => void;
  drawImage: (...args: unknown[]) => void;
  fillText: (text: string, x: number, y: number) => void;
  strokeText: (text: string, x: number, y: number) => void;
  save: () => void;
  restore: () => void;
  translate: (x: number, y: number) => void;
  rotate: (angle: number) => void;
  scale: (x: number, y: number) => void;
  setLineDash: (segments: number[]) => void;
  clip: () => void;
  putImageData: (...args: unknown[]) => void;
  getImageData: (sx: number, sy: number, sw: number, sh: number) => ImageData;
  createImageData: (sw: number, sh: number) => ImageData;
};

const parseFontSize = (font: string) => {
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  return match ? Number(match[1]) : DEFAULT_FONT_SIZE;
};

const createImageDataStub = (width: number, height: number): ImageData =>
  ({
    data: new Uint8ClampedArray(Math.max(0, width * height * 4)),
    width,
    height,
    colorSpace: "srgb",
  }) as ImageData;

const createCanvas2DContextStub = (canvas: HTMLCanvasElement): CanvasRenderingContext2D => {
  const context: Canvas2DContextStub = {
    canvas,
    font: `${DEFAULT_FONT_SIZE}px sans-serif`,
    textAlign: "start",
    textBaseline: "alphabetic",
    strokeStyle: "#000",
    fillStyle: "#000",
    lineWidth: 1,
    globalAlpha: 1,
    measureText: (text: string) => {
      const fontSize = parseFontSize(context.font);
      const width = Math.max(fontSize, text.length * fontSize * DEFAULT_TEXT_WIDTH_FACTOR);
      return {
        width,
        actualBoundingBoxAscent: fontSize,
        actualBoundingBoxDescent: 0,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: width,
        alphabeticBaseline: 0,
        emHeightAscent: fontSize,
        emHeightDescent: 0,
        fontBoundingBoxAscent: fontSize,
        fontBoundingBoxDescent: 0,
        hangingBaseline: 0,
        ideographicBaseline: 0,
      } as TextMetrics;
    },
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    quadraticCurveTo: () => {},
    bezierCurveTo: () => {},
    rect: () => {},
    roundRect: () => {},
    arc: () => {},
    ellipse: () => {},
    fill: () => {},
    stroke: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    clearRect: () => {},
    drawImage: () => {},
    fillText: () => {},
    strokeText: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    setLineDash: () => {},
    clip: () => {},
    putImageData: () => {},
    getImageData: (_sx, _sy, sw, sh) => createImageDataStub(sw, sh),
    createImageData: (sw, sh) => createImageDataStub(sw, sh),
  };

  return context as unknown as CanvasRenderingContext2D;
};

declare global {
  interface HTMLCanvasElement {
    __hookCanvas2DContext__?: CanvasRenderingContext2D;
  }
}

if (typeof HTMLCanvasElement !== "undefined") {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  // The stub only implements the "2d" context; the assignment is cast because a
  // single-signature function cannot satisfy `getContext`'s overload set.
  HTMLCanvasElement.prototype.getContext = function getContextPatched(
    this: HTMLCanvasElement,
    contextId: string,
    options?: unknown,
  ): RenderingContext | null {
    if (contextId === "2d") {
      if (!this.__hookCanvas2DContext__) {
        this.__hookCanvas2DContext__ = createCanvas2DContextStub(this);
      }
      return this.__hookCanvas2DContext__;
    }

    return originalGetContext.call(this, contextId, options as never);
  } as typeof HTMLCanvasElement.prototype.getContext;
}

export {};
