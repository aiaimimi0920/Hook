import type { Unit } from "../types/unit";
import type { FileNamingContext } from "../types/fileNaming";
import { buildUnitFileNamingContext } from "./fileNaming";

export type UnitDragExportPlan =
    | {
          kind: "path";
          path: string;
          fileNamingContext: FileNamingContext;
          cacheSavedPath: false;
      }
    | {
          kind: "data-url";
          dataUrl: string;
          fileNamingContext: FileNamingContext;
          cacheSavedPath: true;
      }
    | {
          kind: "rendered-composite";
          fileNamingContext: FileNamingContext;
          cacheSavedPath: true;
      };

export type NativeDragOverlayPayload = {
    x?: number;
    y?: number;
    globalX?: number;
    globalY?: number;
    scaleFactor?: number;
    physicalOriginX?: number;
    physicalOriginY?: number;
};

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);

const isNonEmptyString = (value: string | undefined | null): value is string =>
    typeof value === "string" && value.length > 0;

const isImageDataUrl = (value: string | undefined | null): value is string =>
    typeof value === "string" && value.startsWith("data:image");

const unwrapImageOutputValue = (value: unknown): string | undefined => {
    if (typeof value === "string" && isImageDataUrl(value)) {
        return value;
    }
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    return [record.data, record.src, record.url]
        .find((candidate): candidate is string =>
            isImageDataUrl(typeof candidate === "string" ? candidate : undefined),
        );
};

export const resolveArtFormalImageDataUrl = (unit: Unit): string | undefined => {
    if (unit.type !== "art" || !unit.data.outputs) {
        return undefined;
    }
    const declaredImageOutputs = unit.outputs
        .filter((port) => port.type === "image")
        .map((port) => port.id);
    const outputIds = Array.from(new Set(["output", "output_image", ...declaredImageOutputs]));
    for (const outputId of outputIds) {
        const source = unwrapImageOutputValue(unit.data.outputs[outputId]);
        if (source) {
            return source;
        }
    }
    return Object.values(unit.data.outputs)
        .map(unwrapImageOutputValue)
        .find(isNonEmptyString);
};

export const resolveNativeDragPreviewPointFromOverlay = (
    payload: NativeDragOverlayPayload | undefined,
) => {
    const x = payload?.x ?? payload?.globalX;
    const y = payload?.y ?? payload?.globalY;
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
        return null;
    }
    return { x, y };
};

export const resolveNativeDragDropPhysicalPointFromOverlay = (
    payload: NativeDragOverlayPayload | undefined,
) => {
    if (isFiniteNumber(payload?.globalX) && isFiniteNumber(payload?.globalY)) {
        return {
            x: payload.globalX,
            y: payload.globalY,
        };
    }

    if (!isFiniteNumber(payload?.x) || !isFiniteNumber(payload?.y)) {
        return null;
    }

    const hasPhysicalOrigin =
        isFiniteNumber(payload?.physicalOriginX) && isFiniteNumber(payload?.physicalOriginY);
    const scaleFactor =
        isFiniteNumber(payload?.scaleFactor) && payload.scaleFactor > 0
            ? payload.scaleFactor
            : 1;

    return {
        x: (hasPhysicalOrigin ? payload!.physicalOriginX! : 0) + payload.x * scaleFactor,
        y: (hasPhysicalOrigin ? payload!.physicalOriginY! : 0) + payload.y * scaleFactor,
    };
};

export const resolveNativeDragDropPhysicalPointFromPointer = (
    point: {
        clientX: number;
        clientY: number;
        screenX?: number;
        screenY?: number;
    },
    devicePixelRatio = 1,
) => {
    const scale =
        Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
            ? devicePixelRatio
            : 1;
    const x = isFiniteNumber(point.screenX) ? point.screenX : point.clientX;
    const y = isFiniteNumber(point.screenY) ? point.screenY : point.clientY;
    return {
        x: x * scale,
        y: y * scale,
    };
};

/** Converts a local path into a file URL without allowing URI-list line injection. */
export const resolveUnitDragFileUrl = (filePath: string): string | null => {
    const hasControlCharacter = Array.from(filePath).some((character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f || code === 0x7f;
    });
    if (!filePath || hasControlCharacter) return null;
    const normalized = filePath.replace(/\\/g, "/");
    if (normalized.startsWith("//")) {
        const [host, ...segments] = normalized.slice(2).split("/");
        if (!host) return null;
        const encodedPath = segments.map((segment) => encodeURIComponent(segment)).join("/");
        return `file://${encodeURIComponent(host)}/${encodedPath}`;
    }

    const rootedPath = normalized.startsWith("/") ? normalized : `/${normalized}`;
    const encodedPath = rootedPath
        .split("/")
        .map((segment, index) => index === 1 && /^[A-Za-z]:$/.test(segment)
            ? segment
            : encodeURIComponent(segment))
        .join("/");
    return `file://${encodedPath}`;
};

export const resolveExistingUnitDragFilePath = (unit: Unit): string | undefined => {
    if (isNonEmptyString(unit.data.dragOutFilePath)) {
        return unit.data.dragOutFilePath;
    }
    if (!isNonEmptyString(unit.data.filePath)) {
        return undefined;
    }
    if (unit.type === "art") {
        return unit.data.filePath;
    }
    if (unit.data.rasterizedAnnotationLayerSrc) {
        return undefined;
    }
    if ((unit.data.annotationState?.elements?.length || 0) > 0) {
        return undefined;
    }

    const imageEditState = unit.data.imageEditState;
    if (!imageEditState) {
        return unit.data.filePath;
    }
    if ((imageEditState.contentEraseStrokes?.length || 0) > 0) {
        return undefined;
    }
    if (imageEditState.cropRect) {
        return undefined;
    }
    if (imageEditState.flippedX || imageEditState.flippedY) {
        return undefined;
    }
    if ((imageEditState.borderWidth || 0) > 0) {
        return undefined;
    }
    if ((imageEditState.cornerRadius || 0) > 0) {
        return undefined;
    }
    if (imageEditState.beautify?.enabled) {
        return undefined;
    }

    return unit.data.filePath;
};

export const resolveUnitDragExportPlan = (input: {
    unit: Unit;
    capabilityLabel?: string;
    displaySrc?: string;
    formalImagePending?: boolean;
}): UnitDragExportPlan | null => {
    if (input.formalImagePending) {
        return null;
    }

    const fileNamingContext = buildUnitFileNamingContext(input.unit, input.capabilityLabel);
    const displayOverridesStoredStickerImage =
        input.unit.type !== "art" &&
        isNonEmptyString(input.displaySrc) &&
        input.displaySrc !== input.unit.data.src &&
        input.displaySrc !== input.unit.data.filePath;
    const existingPath = displayOverridesStoredStickerImage
        ? undefined
        : resolveExistingUnitDragFilePath(input.unit);
    if (existingPath) {
        return {
            kind: "path",
            path: existingPath,
            fileNamingContext,
            cacheSavedPath: false,
        };
    }

    if (input.unit.type === "art") {
        const inlineSource = resolveArtFormalImageDataUrl(input.unit);
        if (!inlineSource) {
            return null;
        }
        return {
            kind: "data-url",
            dataUrl: inlineSource,
            fileNamingContext,
            cacheSavedPath: true,
        };
    }

    const visibleSrc = input.displaySrc || input.unit.data.previewSrc || input.unit.data.src;
    if (!visibleSrc) {
        return null;
    }

    return {
        kind: "rendered-composite",
        fileNamingContext,
        cacheSavedPath: true,
    };
};
