import type {
    SurfacePackageManifest,
    SurfaceSnapshot,
    SurfaceViewDefinition,
} from "./surfaceProtocol";
import type { StickerImageEditState } from "../types/stickerEditing";

const SAFE_SURFACE_VIEW_ID = /^[A-Za-z0-9._:/-]{1,160}$/;
const MAX_SURFACE_VIEW_DIMENSION = 16_384;

const isValidView = (view: SurfaceViewDefinition): boolean =>
    SAFE_SURFACE_VIEW_ID.test(view.id)
    && typeof view.label === "string"
    && view.label.trim().length > 0
    && view.label.length <= 80
    && Number.isInteger(view.fullSize?.width)
    && view.fullSize.width > 0
    && view.fullSize.width <= MAX_SURFACE_VIEW_DIMENSION
    && Number.isInteger(view.fullSize?.height)
    && view.fullSize.height > 0
    && view.fullSize.height <= MAX_SURFACE_VIEW_DIMENSION;

export const normalizeSurfaceViews = (
    surface: SurfacePackageManifest | undefined,
): SurfaceViewDefinition[] => {
    const seen = new Set<string>();
    return (surface?.views ?? []).filter((view) => {
        if (!isValidView(view) || seen.has(view.id)) return false;
        seen.add(view.id);
        return true;
    });
};

export const resolveSurfaceView = (
    surface: SurfacePackageManifest | undefined,
    requestedViewId?: string,
): SurfaceViewDefinition | undefined => {
    const views = normalizeSurfaceViews(surface);
    return views.find((view) => view.id === requestedViewId)
        ?? views.find((view) => view.id === surface?.defaultViewId)
        ?? views[0];
};

export const computeSurfaceViewResetFrame = (
    frame: { x: number; y: number; w: number; h: number },
    view: SurfaceViewDefinition,
) => ({
    x: frame.x + (frame.w - view.fullSize.width) / 2,
    y: frame.y + (frame.h - view.fullSize.height) / 2,
    w: view.fullSize.width,
    h: view.fullSize.height,
});

export interface SurfaceViewPresentation {
    logicalWidth: number;
    logicalHeight: number;
    scale: number;
    left: number;
    top: number;
}

export const computeSurfaceViewPresentation = (
    frame: { w: number; h: number },
    view: SurfaceViewDefinition,
): SurfaceViewPresentation => {
    const scale = Math.max(
        0.01,
        Math.min(frame.w / view.fullSize.width, frame.h / view.fullSize.height),
    );
    const displayWidth = view.fullSize.width * scale;
    const displayHeight = view.fullSize.height * scale;
    return {
        logicalWidth: view.fullSize.width,
        logicalHeight: view.fullSize.height,
        scale,
        left: (frame.w - displayWidth) / 2,
        top: (frame.h - displayHeight) / 2,
    };
};

export interface SurfaceViewWindowOptions {
    minified?: boolean;
    savedRect?: { w: number; h: number };
    cropOffset?: { x: number; y: number };
    imageEditState?: Pick<StickerImageEditState, "cropRect" | "sourceSize">;
}

/**
 * Keeps the Surface mounted at its full logical size and moves that full
 * presentation behind the host's clipping window. Crop and compact modes must
 * never resize the Surface to the visible window, otherwise text and charts are
 * reflowed instead of showing the selected region.
 */
export const computeSurfaceViewWindowPresentation = (
    frame: { w: number; h: number },
    view: SurfaceViewDefinition | undefined,
    options: SurfaceViewWindowOptions = {},
): SurfaceViewPresentation => {
    const windowBase = options.minified && options.savedRect
        ? options.savedRect
        : frame;
    const cropRect = options.imageEditState?.cropRect;
    const sourceSize = options.imageEditState?.sourceSize;
    const hasCrop = !!cropRect
        && !!sourceSize
        && cropRect.w > 0
        && cropRect.h > 0
        && sourceSize.w > 0
        && sourceSize.h > 0;

    let presentation: SurfaceViewPresentation;
    if (hasCrop) {
        const stageScale = Math.max(
            0.01,
            Math.min(windowBase.w / cropRect.w, windowBase.h / cropRect.h),
        );
        const base = view
            ? computeSurfaceViewPresentation(sourceSize, view)
            : {
                  logicalWidth: sourceSize.w,
                  logicalHeight: sourceSize.h,
                  scale: 1,
                  left: 0,
                  top: 0,
              };
        presentation = {
            logicalWidth: base.logicalWidth,
            logicalHeight: base.logicalHeight,
            scale: base.scale * stageScale,
            left: (base.left - cropRect.x) * stageScale,
            top: (base.top - cropRect.y) * stageScale,
        };
    } else if (view) {
        presentation = computeSurfaceViewPresentation(windowBase, view);
    } else {
        presentation = {
            logicalWidth: windowBase.w,
            logicalHeight: windowBase.h,
            scale: 1,
            left: 0,
            top: 0,
        };
    }

    if (!options.minified) return presentation;
    return {
        ...presentation,
        left: presentation.left - (options.cropOffset?.x ?? 0),
        top: presentation.top - (options.cropOffset?.y ?? 0),
    };
};

export const clearSurfaceViewCrop = (
    imageEditState: StickerImageEditState | undefined,
): StickerImageEditState | undefined => imageEditState
    ? {
          ...imageEditState,
          cropRect: undefined,
          sourceSize: undefined,
      }
    : undefined;

export const applySurfaceViewToSnapshot = (
    snapshot: SurfaceSnapshot,
    view: SurfaceViewDefinition | undefined,
): SurfaceSnapshot => view && snapshot.viewId !== view.id
    ? { ...snapshot, viewId: view.id }
    : snapshot;
