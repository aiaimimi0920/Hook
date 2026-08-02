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
}): UnitDragExportPlan | null => {
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
        const inlineSource = [
            input.unit.data.previewSrc,
            input.displaySrc,
            input.unit.data.src,
        ].find(isImageDataUrl);
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
