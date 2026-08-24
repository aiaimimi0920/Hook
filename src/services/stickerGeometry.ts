/**
 * Stable sticker-geometry facade.
 *
 * Geometry owners stay split by responsibility while production callers keep
 * this import path and its existing public surface.
 */
export type {
    AnnotationBounds,
    AnnotationScale,
    LineEndpointHandle,
    ResizeHandle,
    ShapeBox,
} from "./stickerGeometryTypes";

export {
    buildArrowHeadPolygon,
    getArrowHeadAnchorSegment,
    getArrowShaftPoints,
} from "./stickerArrowGeometry";

export {
    getAnnotationBounds,
    getAnnotationCenter,
    getAnnotationGroupBounds,
    getAnnotationGroupCenter,
} from "./stickerAnnotationBounds";

export {
    cloneStickerAnnotation,
    moveLineEndpoint,
    resizeBoxAnnotation,
    translateAnnotation,
} from "./stickerAnnotationEditGeometry";

export {
    annotationContainsPoint,
    findTopmostAnnotationAtPoint,
} from "./stickerAnnotationHitTest";

export {
    rotateAnnotationAroundCenter,
    rotateAnnotationsAroundGroupCenter,
    rotateAnnotationsAroundOwnCenters,
    scaleAnnotationAroundCenter,
    scaleAnnotationsAroundGroupCenter,
    scaleAnnotationsAroundOwnCenters,
} from "./stickerAnnotationTransforms";

export {
    buildPolygonPoints,
    buildRoundedPolygonPath,
    buildTrianglePoints,
    MIN_POLYGON_SIDES,
    toSvgPoints,
    traceRoundedPolygonPath,
} from "./stickerShapeGeometry";
