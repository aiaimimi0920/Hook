import { Match, Show, Switch, createEffect, createMemo, createSignal, createUniqueId, onCleanup, type Component } from "solid-js";

import { BLUR_EFFECT_OVERLAY_FILL, buildMosaicTextureDataUrl } from "../services/stickerEffects";
import type { StickerPoint } from "../types/stickerEditing";
import { acquireStickerBlurTexture } from "../services/stickerBlurTexture";
import { createDecodedImageSource } from "../../../shared/images/decodedImageSource";

type StickerEffectOverlayParams = {
    // Bounding box of the brush stroke (already expanded by half the brush
    // width). Only used as a fallback; the effect is painted directly along the
    // stroke path as a pattern stroke, so it tracks the cursor instantly.
    x: number;
    y: number;
    w: number;
    h: number;
    points: StickerPoint[];
    brushWidth: number;
    // Unique id seed so each overlay's <pattern>/<filter> defs do not collide.
    maskId: string;
    effectType: "mosaic" | "blur";
    strength: number;
    draft?: boolean;
    // The underlying sticker image + its on-screen size. The blur brush reveals a
    // pre-blurred copy of this image along the stroke, so it never recomputes a
    // backdrop filter per frame.
    imageSrc?: string;
    stickerWidth?: number;
    stickerHeight?: number;
};

// Build the SVG path that traces the brush stroke. A single point still needs a
// tiny segment so the round line cap paints a dot.
export const buildStrokePath = (points: StickerPoint[]) => {
    if (points.length === 0) return "";
    if (points.length === 1) {
        const p = points[0];
        return `M ${p.x} ${p.y} L ${p.x + 0.01} ${p.y}`;
    }
    return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
};

// Mosaic grid <pattern> defs. The mosaic is a grid of square cells, each colored
// from a soft blue-gray palette by its ABSOLUTE (column, row) in the full sticker
// — so the grid has NO repeating period and the eye never sees the same block of
// cells repeat. The cells NEVER sample the underlying image, so the censored
// content cannot leak. The texture is rendered once per stroke into a sticker-
// sized PNG (buildMosaicTextureDataUrl) and referenced as a single <image> filling
// a sticker-sized (non-repeating) pattern, so per-frame work stays at one <path d>
// update.
const MosaicGridDefs: Component<{
    patternId: string;
    textureSrc: string;
    imageW: number;
    imageH: number;
}> = (props) => (
    <defs>
        <pattern
            id={props.patternId}
            patternUnits="userSpaceOnUse"
            x={0}
            y={0}
            width={props.imageW}
            height={props.imageH}
        >
            <image
                href={props.textureSrc}
                x={0}
                y={0}
                width={props.imageW}
                height={props.imageH}
                preserveAspectRatio="none"
                style={{ "image-rendering": "pixelated" }}
            />
        </pattern>
    </defs>
);

// An SVG filter inside a pattern is repainted with the stroke, even when its DOM
// is stable. Replace it with a shared raster, retaining SVG only while loading or
// when the bounded raster cache / image origin cannot provide a texture.
const BlurPatternDefs: Component<{
    filterId: string;
    patternId: string;
    blurRadius: number;
    imageSrc: string;
    imageW: number;
    imageH: number;
}> = (props) => {
    const [texture, setTexture] = createSignal<string | null>(null);
    const decodedTexture = createDecodedImageSource(texture);
    const source = createMemo(() => props.imageSrc);
    const width = createMemo(() => props.imageW);
    const height = createMemo(() => props.imageH);
    const radius = createMemo(() => props.blurRadius);
    createEffect(() => {
        const lease = acquireStickerBlurTexture(source(), width(), height(), radius());
        setTexture(lease.url);
        let active = true;
        void lease.ready.then((url) => { if (active) setTexture(url); });
        onCleanup(() => { active = false; lease.release(); });
    });
    return (
    <defs>
        <Show when={!decodedTexture()}><filter id={props.filterId} x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
            <feGaussianBlur stdDeviation={props.blurRadius} />
        </filter></Show>
        <pattern
            id={props.patternId}
            patternUnits="userSpaceOnUse"
            x={0}
            y={0}
            width={props.imageW}
            height={props.imageH}
        >
            <image
                href={decodedTexture() || props.imageSrc}
                x={0}
                y={0}
                width={props.imageW}
                height={props.imageH}
                preserveAspectRatio={decodedTexture() ? "none" : "xMidYMid meet"}
                filter={decodedTexture() ? undefined : `url(#${props.filterId})`}
            />
        </pattern>
    </defs>
    );
};

// Shared brush-stroke renderer. `pathData` is an accessor so the live draft can
// update only the <path d> attribute every pointer move. Defs stay mounted and
// their raster textures are independent of both points and brush width.
const EffectStrokeBrush: Component<{
    effectType: "mosaic" | "blur";
    pathData: () => string;
    brushWidth: number;
    strength: number;
    imageSrc?: string;
    imageW: number;
    imageH: number;
    idSeed: string;
    draft?: boolean;
}> = (props) => {
    // Propagated annotations retain their IDs; SVG references are document-wide.
    // Scope both committed and draft resources to this mount, not the stored ID.
    const instanceId = createUniqueId();
    const isMosaic = createMemo(() => props.effectType === "mosaic");
    // Blur must not reveal extra sharp source pixels while the pointer is down.
    const opacity = () => 1;
    const mosaicPatternId = createMemo(() => `${props.idSeed}-${instanceId}-mosaic-pattern`);
    const blurFilterId = createMemo(() => `${props.idSeed}-${instanceId}-blur-filter`);
    const blurPatternId = createMemo(() => `${props.idSeed}-${instanceId}-blur-pattern`);
    // The "strength" slider sets the cell size. Build the full non-repeating
    // mosaic-grid texture once for this stroke; it never samples the image, so
    // there is zero risk of leaking content.
    const mosaicTextureSrc = createMemo(() =>
        isMosaic() ? buildMosaicTextureDataUrl(props.imageW, props.imageH, Math.max(2, Math.round(props.strength || 12))) : null,
    );
    const decodedMosaic = createDecodedImageSource(mosaicTextureSrc);
    const decodedBase = createDecodedImageSource(() => isMosaic() ? undefined : props.imageSrc);
    const blurRadius = createMemo(() => Math.max(0.1, props.strength || 8));

    return (
        <Switch>
            <Match when={isMosaic()}>
                <g opacity={opacity()}>
                    <Show
                        when={decodedMosaic()}
                        fallback={
                            <path
                                d={props.pathData()}
                                stroke="#808a96"
                                stroke-width={props.brushWidth}
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                fill="none"
                            />
                        }
                    >
                        {(src) => (
                            <>
                                <MosaicGridDefs
                                    patternId={mosaicPatternId()}
                                    textureSrc={src()}
                                    imageW={props.imageW}
                                    imageH={props.imageH}
                                />
                                <path
                                    d={props.pathData()}
                                    stroke={`url(#${mosaicPatternId()})`}
                                    stroke-width={props.brushWidth}
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    fill="none"
                                />
                            </>
                        )}
                    </Show>
                </g>
            </Match>
            <Match when={true}>
                <g opacity={opacity()}>
                    <Show
                        when={decodedBase()}
                        fallback={
                            <path
                                d={props.pathData()}
                                stroke="#808a96"
                                stroke-width={props.brushWidth}
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                fill="none"
                            />
                        }
                    >
                        {(src) => (
                            <>
                                <BlurPatternDefs
                                    filterId={blurFilterId()}
                                    patternId={blurPatternId()}
                                    blurRadius={blurRadius()}
                                    imageSrc={src()}
                                    imageW={props.imageW}
                                    imageH={props.imageH}
                                />
                                <path
                                    d={props.pathData()}
                                    stroke={`url(#${blurPatternId()})`}
                                    stroke-width={props.brushWidth}
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    fill="none"
                                />
                            </>
                        )}
                    </Show>
                </g>
            </Match>
        </Switch>
    );
};

// Live draft overlay. Mount this inside a <Show> keyed on the effect MODE (not the
// points), so the component body — and therefore the expensive <defs> — runs once
// per stroke. Pass `pathData` as an accessor reading the draft points; only the
// <path d> updates per frame, exactly like the plain brush.
export const StickerEffectDraftOverlay: Component<{
    effectType: "mosaic" | "blur";
    pathData: () => string;
    brushWidth: number;
    strength: number;
    imageSrc?: string;
    stickerWidth: number;
    stickerHeight: number;
}> = (props) => (
    <EffectStrokeBrush
        effectType={props.effectType}
        pathData={props.pathData}
        brushWidth={props.brushWidth}
        strength={props.strength}
        imageSrc={props.imageSrc}
        imageW={props.stickerWidth}
        imageH={props.stickerHeight}
        idSeed="__draft_effect__"
        draft
    />
);

// Committed (static) effect annotation. The path is fixed, so a plain string is
// fine — no reactive accessor needed.
export const renderStickerEffectOverlay = (params: StickerEffectOverlayParams) => {
    const path = buildStrokePath(params.points);
    return (
        <EffectStrokeBrush
            effectType={params.effectType}
            pathData={() => path}
            brushWidth={params.brushWidth}
            strength={params.strength}
            imageSrc={params.imageSrc}
            imageW={params.stickerWidth ?? params.w}
            imageH={params.stickerHeight ?? params.h}
            idSeed={params.maskId}
            draft={params.draft}
        />
    );
};

// Kept for any callers that still want the raw blur fill constant.
export { BLUR_EFFECT_OVERLAY_FILL };
