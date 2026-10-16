import { createWallGeometry } from './wallGeometry';
import type { TileEndpoint, WallLayout } from './wallTypes';

/** Draw in wall coordinates through the same inverse transform used by content projection. */
export function drawTileTestPattern(canvas: HTMLCanvasElement, layout: WallLayout, endpoint: TileEndpoint): void {
    const tile = layout.tiles.find((t) => t.endpointId === endpoint.endpointId);
    if (!tile) throw new Error('tile_not_in_layout');
    const b = layout.bounds;
    const testLayout: WallLayout = { ...layout, placements: [{ placementId: 'test-pattern',
        source: { kind: 'image', id: `sha256:${'0'.repeat(64)}` }, rect: b,
        sourceCrop: { x: 0, y: 0, width: 1, height: 1 }, zIndex: 0, interactive: false }] };
    const [projection] = createWallGeometry(testLayout, endpoint, tile.tileId).projections();
    if (!projection) throw new Error('tile_projection_missing');
    canvas.width = endpoint.pixelSize.width; canvas.height = endpoint.pixelSize.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('tile_canvas_unavailable');
    const [q0, q1, , q3] = projection.outputQuad, r = projection.visibleWallRect;
    const a = (q1.x - q0.x) * canvas.width / r.width;
    const b1 = (q1.y - q0.y) * canvas.height / r.width;
    const c = (q3.x - q0.x) * canvas.width / r.height;
    const d = (q3.y - q0.y) * canvas.height / r.height;
    context.setTransform(a, b1, c, d, q0.x * canvas.width - a * r.x - c * r.y,
        q0.y * canvas.height - b1 * r.x - d * r.y);
    const gradient = context.createLinearGradient(b.x, b.y, b.x + b.width, b.y + b.height);
    gradient.addColorStop(0, '#06b6d4'); gradient.addColorStop(1, '#22c55e');
    context.fillStyle = gradient; context.fillRect(b.x, b.y, b.width, b.height);
    const spacing = 2 ** Math.ceil(Math.log2(Math.max(b.width, b.height) / 24));
    context.strokeStyle = '#06080d'; context.lineWidth = spacing / 70;
    context.beginPath();
    for (let x = Math.ceil(b.x / spacing) * spacing; x <= b.x + b.width; x += spacing) {
        context.moveTo(x, b.y); context.lineTo(x, b.y + b.height);
    }
    for (let y = Math.ceil(b.y / spacing) * spacing; y <= b.y + b.height; y += spacing) {
        context.moveTo(b.x, y); context.lineTo(b.x + b.width, y);
    }
    context.moveTo(b.x, b.y); context.lineTo(b.x + b.width, b.y + b.height);
    context.moveTo(b.x + b.width, b.y); context.lineTo(b.x, b.y + b.height);
    context.stroke();
    context.setTransform(1, 0, 0, 1, 0, 0);
}
