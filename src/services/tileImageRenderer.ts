/** Paint a complete admitted image set through the shared versioned projection contract. */
import { readWallImage } from './apiWallImages';
import { createTileImageCache } from './tileImageCache';
import { createTileLiveCache } from './tileLiveCache';
import { drawTileTestPattern } from './tileTestPattern';
import { createWallGeometry } from './wallGeometry';
import type { TileEndpoint, WallLayout, WallPresentation, WallScene } from './wallTypes';
import { createTileSceneGate } from './tileSceneGate';
import type { TileClock } from './tileClock';
import type { TilePresentationResult } from './tilePresenter';
import type { createTileSurfaceController } from './tileSurfaceController';

export function createTileImageRenderer(canvasElement: () => HTMLCanvasElement, reason: (value: string) => void, unavailable: () => void = () => {},
    surfaces?: ReturnType<typeof createTileSurfaceController>, mediaElement?: () => HTMLCanvasElement,
    clock?: TileClock, visible: (value: boolean) => void = () => {}) {
    const cache = createTileImageCache();
    const live = createTileLiveCache(undefined, undefined, clock);
    let presentationVisible = false;
    const sceneGate = createTileSceneGate(clock, (value) => {
        if (!value && presentationVisible) { unavailable(); completeKey = ''; }
        presentationVisible = value; visible(value);
    });
    let appliedKey = '';
    let completeKey = '';
    let animation: number | undefined;
    let authorizedUntil = 0;
    let paint: (() => number | null) | undefined;
    function clearCanvas(message: string) {
        if (appliedKey) unavailable();
        appliedKey = ''; completeKey = ''; reason(message);
        const canvas = canvasElement();
        const context = canvas?.getContext('2d');
        if (context) { context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, canvas.width, canvas.height); }
        const media = mediaElement?.();
        media?.getContext('2d')?.clearRect(0, 0, media.width, media.height);
    }
    function clear(message: string) {
        unavailable();
        sceneGate.clear();
        cache.clear(); live.clear(); surfaces?.clear(); paint = undefined;
        if (animation !== undefined) cancelAnimationFrame(animation);
        animation = undefined; clearCanvas(message);
    }
    function animate() {
        animation = undefined;
        if (!paint) return;
        if (Date.now() >= authorizedUntil) { clear('tile_live_authorization_timeout'); return; }
        paint(); animation = requestAnimationFrame(animate);
    }
    const renderKey = (layout: WallLayout, endpoint: TileEndpoint, leaseId: string) =>
        `${endpoint.endpointId}:${leaseId}:${layout.wallId}:${layout.revision}:${endpoint.pixelSize.width}:${endpoint.pixelSize.height}`;
    async function applyRunning(layout: WallLayout | null, endpoint: TileEndpoint, leaseId: string, scene?: WallScene): Promise<number | null> {
        if (!layout) { clear('等待 Loom 分配墙面'); return null; }
        const key = renderKey(layout, endpoint, leaseId);
        if (sceneGate.begin(key, scene)) unavailable();
        const canvas = canvasElement();
        if (!layout.placements.length) {
            cache.clear(); live.clear(); paint = undefined;
            surfaces?.clear();
            const media = mediaElement?.(); if (media) { media.width = 0; media.height = 0; }
            if (animation !== undefined) cancelAnimationFrame(animation);
            animation = undefined;
            authorizedUntil = Date.now() + 6000;
            paint = () => {
                if (!sceneGate.permit(true)) { reason('tile_scene_preparing'); return null; }
                if (key !== appliedKey) { drawTileTestPattern(canvas, layout, endpoint); appliedKey = key; }
                if (!sceneGate.applied()) { reason('tile_scene_preparing'); return null; }
                completeKey = key; reason(''); return layout.revision;
            };
            if (scene && animation === undefined) animation = requestAnimationFrame(animate);
            return paint();
        }
        const tile = layout.tiles.find((candidate) => candidate.endpointId === endpoint.endpointId);
        if (!tile) throw new Error('tile_not_in_layout');
        const projections = createWallGeometry(layout, endpoint, tile.tileId).projections();
        const placements = new Map(layout.placements.map((placement) => [placement.placementId, placement]));
        const visible = projections.map((projection) => placements.get(projection.placementId)!);
        const hasSurfaces = visible.some((placement) => placement.source.kind === 'surface');
        if (hasSurfaces && (!surfaces || !mediaElement)) {
            clear('tile_content_transport_pending：Art 内容传输尚未接通'); return null;
        }
        surfaces?.prepare(key, layout, endpoint, leaseId, projections);
        const imageIds = visible.filter((p) => p.source.kind === 'image').map((p) => p.source.id);
        const liveIds = visible.filter((p) => p.source.kind === 'live').map((p) => p.source.id);
        if (!live.prepare(key, liveIds, { endpointId: endpoint.endpointId, leaseId, revision: layout.revision,
            format: endpoint.renderModes.includes('raw_bgra') ? 'raw_bgra' : 'png' })) {
            clear('tile_live_stream_limit'); return null;
        }
        const ready = cache.prepare(key, imageIds,
            (id) => readWallImage(endpoint.deviceId, endpoint.endpointId, leaseId, layout.revision, id));
        authorizedUntil = Date.now() + 6000;
        paint = () => {
        live.advance();
        if (!ready.ready) { sceneGate.permit(false); clearCanvas(ready.reason); return null; }
        if (liveIds.some((id) => !live.get(id))) { sceneGate.permit(false); clearCanvas(live.reason()); return null; }
        if (surfaces && !surfaces.ready()) { sceneGate.permit(false); clearCanvas(surfaces.reason()); return null; }
        if (!sceneGate.permit(true)) { reason('tile_scene_preparing'); return null; }
        const frameKey = `${key}:${live.version()}`;
        if (frameKey === appliedKey) {
            if (!sceneGate.applied()) { reason('tile_scene_preparing'); return null; }
            completeKey = key; reason(''); return layout.revision;
        }
        if (canvas.width !== endpoint.pixelSize.width) canvas.width = endpoint.pixelSize.width;
        if (canvas.height !== endpoint.pixelSize.height) canvas.height = endpoint.pixelSize.height;
        function draw(target: HTMLCanvasElement, overlay: boolean) {
        const context = target.getContext('2d');
        if (!context) throw new Error('tile_canvas_unavailable');
        context.clearRect(0, 0, target.width, target.height);
        if (!overlay) { context.fillStyle = '#000'; context.fillRect(0, 0, target.width, target.height); }
        for (const projection of projections) {
            const placement = placements.get(projection.placementId)!;
            if (placement.source.kind === 'surface') continue;
            const clips = overlay ? surfaces?.mediaClips().get(placement.placementId) : undefined;
            if (overlay && !clips?.length) continue;
            const image = placement.source.kind === 'live' ? live.get(placement.source.id)! : cache.get(placement.source.id)!;
            const [q0, q1, , q3] = projection.outputQuad, crop = projection.sourceCrop;
            context.save();
            if (clips) {
                context.beginPath();
                for (const rect of clips) context.rect(rect.x * canvas.width, rect.y * canvas.height, rect.width * canvas.width, rect.height * canvas.height);
                context.clip();
            }
            context.setTransform((q1.x - q0.x) * canvas.width, (q1.y - q0.y) * canvas.height,
                (q3.x - q0.x) * canvas.width, (q3.y - q0.y) * canvas.height, q0.x * canvas.width, q0.y * canvas.height);
            context.beginPath(); context.rect(0, 0, 1, 1); context.clip();
            context.drawImage(image.source, crop.x * image.width, crop.y * image.height,
                crop.width * image.width, crop.height * image.height, 0, 0, 1, 1);
            context.restore();
        }
        }
        draw(canvas, false);
        const media = mediaElement?.();
        if (media) {
            const enabled = Boolean(surfaces?.mediaClips().size);
            if (media.width !== (enabled ? canvas.width : 0)) media.width = enabled ? canvas.width : 0;
            if (media.height !== (enabled ? canvas.height : 0)) media.height = enabled ? canvas.height : 0;
            if (enabled) draw(media, true);
        }
        appliedKey = frameKey;
        if (!sceneGate.applied()) { completeKey = ''; reason('tile_scene_preparing'); return null; }
        completeKey = key; reason(''); return layout.revision;
        };
        if ((scene || liveIds.length || hasSurfaces) && animation === undefined) animation = requestAnimationFrame(animate);
        return paint();
    }
    async function apply(layout: WallLayout | null, endpoint: TileEndpoint, leaseId: string, presentation?: WallPresentation, scene?: WallScene): Promise<TilePresentationResult> {
        if (!presentation) {
            const appliedRevision = await applyRunning(layout, endpoint, leaseId, scene);
            const report = sceneGate.report();
            return { appliedRevision, ...(report ? { scene: report } : {}) };
        }
        if (presentation.mode === 'black') {
            clear('');
            return { appliedRevision: null, presentation: { revision: presentation.revision, outcome: 'applied' } };
        }
        const retained = Boolean(layout && completeKey === renderKey(layout, endpoint, leaseId)
            && (!layout.placements.length || !surfaces || surfaces.ready()));
        if (!retained) {
            clear('tile_frozen_frame_unavailable');
            return { appliedRevision: null, presentation: { revision: presentation.revision, outcome: 'frame_unavailable' } };
        }
        // Keep canvas pixels, admitted Art snapshots and their URLs; stop media and reject all late updates.
        paint = undefined;
        if (animation !== undefined) cancelAnimationFrame(animation);
        animation = undefined; surfaces?.hold(); unavailable(); cache.clear(); live.clear(); reason('');
        return { appliedRevision: layout!.revision, presentation: { revision: presentation.revision, outcome: 'applied' } };
    }
    return { apply, clear, mediaStats: live.stats };
}
