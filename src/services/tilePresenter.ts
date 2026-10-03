/** One serial owner for registration, presenter lease, layout application and shutdown. */
import { wallApi } from './apiWall';
import { WALL_PROTOCOL_VERSION, type TileEndpoint, type TileInputCapability, type TileRenderMode, type WallIdentification, type WallLayout, type WallPresentation, type WallPresentationReport, type WallScene, type WallSceneReport } from './wallTypes';
import type { TileClock } from './tileClock';
import { parseTileEndpoint } from './wallProtocol';

export interface TileOutput { outputId: string; name: string; x: number; y: number; width: number; height: number }
export interface TilePresentationResult { appliedRevision: number | null; presentation?: WallPresentationReport; scene?: WallSceneReport }
export interface TilePresenterHost {
    inputCapabilities?: readonly TileInputCapability[];
    renderModes?: readonly TileRenderMode[];
    clock?: TileClock;
    output: () => Promise<TileOutput>;
    apply: (layout: WallLayout | null, endpoint: TileEndpoint, leaseId: string, presentation?: WallPresentation, scene?: WallScene) => Promise<TilePresentationResult>;
    clear: (reason: string) => void;
    status: (message: string) => void;
    presented?: (layout: WallLayout | null, endpoint: TileEndpoint, leaseId: string, applied: number | null) => void;
    identify?: (command: WallIdentification | undefined, endpoint: TileEndpoint, leaseId: string, observedAt: number) => Promise<boolean>;
}

export async function tileEndpointId(deviceId: string, outputId: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${deviceId}\n${outputId}`));
    return `tile-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
export function tileFailure(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code;
    return error instanceof Error ? error.message : typeof error === 'string' ? error : 'tile_unavailable';
}

export function createTilePresenter(host: TilePresenterHost, api: typeof wallApi = wallApi) {
    let stopped = false;
    let lease: { endpointId: string; leaseId: string; sequence: number; generation: number } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running: Promise<void> | undefined;
    let monitorTimer: ReturnType<typeof setTimeout> | undefined;
    let probing: Promise<TileOutput> | undefined;
    let observed: TileOutput | undefined;
    let generation = 0;
    let authorizedUntil = 0;
    let failure = '';
    let nextPollMs = 3000;
    function invalidate(message: string) {
        generation++; authorizedUntil = 0; failure = message;
        host.clear(message); host.status(message);
    }
    function readOutput(): Promise<TileOutput> {
        if (!probing) probing = Promise.resolve().then(host.output).then((output) => {
            if (!Number.isInteger(output.width) || !Number.isInteger(output.height) || output.width < 1 || output.height < 1
                || output.width > 16384 || output.height > 16384 || output.width * output.height > 16_777_216) {
                throw new Error('tile_canvas_pixel_limit');
            }
            if (!stopped) {
                if (observed && JSON.stringify(observed) !== JSON.stringify(output)) invalidate('tile_output_changed');
                observed = output;
            }
            return output;
        }).catch((error: unknown) => {
            if (!stopped && (observed || failure !== tileFailure(error))) invalidate(tileFailure(error));
            observed = undefined;
            throw error;
        }).finally(() => { probing = undefined; });
        return probing;
    }
    function monitor() {
        if (stopped) return;
        if (authorizedUntil && performance.now() >= authorizedUntil) invalidate('tile_authorization_timeout');
        // A pending pairing or HTTP request cannot delay output-loss detection or input revocation.
        // Share one native probe with the control loop; never queue unbounded monitor commands.
        void readOutput().catch(() => {});
        monitorTimer = setTimeout(monitor, 500);
    }
    async function disconnect() {
        const owned = lease; lease = null;
        if (owned) {
            try { await api.disconnect(owned.endpointId, owned.leaseId); }
            catch { /* A broken transport is bounded by the server's 15 second lease TTL. */ }
        }
    }
    async function step() {
        nextPollMs = 3000;
        try {
            const output = await readOutput();
            if (stopped) return;
            const version = generation;
            function isCurrent() {
                if (stopped) return false;
                if (generation !== version) throw new Error(failure || 'tile_output_changed');
                return true;
            }
            if (lease && lease.generation !== version) { await disconnect(); if (!isCurrent()) return; }
            const observedAt = performance.now();
            let current = await api.readState();
            if (current.state.timing && host.clock?.observe(current.state.timing, observedAt, performance.now())) {
                invalidate('tile_clock_changed');
            }
            if (!isCurrent()) return;
            const endpointId = await tileEndpointId(current.deviceId, output.outputId);
            if (!isCurrent()) return;
            // Compare the same canonical DTO shape as the wire parser, not construction key order.
            const endpoint: TileEndpoint = parseTileEndpoint({ protocolVersion: WALL_PROTOCOL_VERSION, endpointId,
                deviceId: current.deviceId, outputId: output.outputId, pixelSize: { width: output.width, height: output.height },
                renderModes: host.renderModes ?? ['image', 'raw_bgra'], inputCapabilities: host.inputCapabilities ?? [],
                ...(host.clock ? { scheduledPresentation: true } : {}),
                ...(host.identify ? { display: { name: output.name, canIdentify: true } } : {}) });
            const registered = current.state.endpoints.find((e) => e.endpoint.endpointId === endpointId)?.endpoint;
            if (JSON.stringify(registered) !== JSON.stringify(endpoint)) {
                await disconnect();
                if (!isCurrent()) return;
                const { deviceId: _identity, ...registration } = endpoint;
                current = await api.register(current.state.revision, registration);
                if (host.clock && current.state.timing && current.state.timing.clockId !== host.clock.id()) invalidate('tile_clock_changed');
                if (!isCurrent()) return;
            }
            if (!lease) {
                const granted = await api.connect(endpointId);
                lease = { endpointId, leaseId: granted.leaseId, sequence: 0, generation: version };
                if (stopped) { await disconnect(); return; }
                isCurrent();
            }
            const layout = current.state.layouts.find((wall) => wall.tiles.some((tile) => tile.endpointId === endpointId)) ?? null;
            const presentation = current.state.presentations?.find((control) => control.wallId === layout?.wallId);
            const scene = current.state.timing?.scenes.find((scene) => scene.wallId === layout?.wallId);
            if (!authorizedUntil) authorizedUntil = performance.now() + 6000;
            const command = current.state.endpoints.find((status) => status.endpoint.endpointId === endpointId)?.identification;
            const identifying = await host.identify?.(command, endpoint, lease.leaseId, observedAt) ?? false;
            if (!isCurrent()) return;
            const result: TilePresentationResult = identifying ? { appliedRevision: null }
                : host.clock
                    ? await host.apply(layout, endpoint, lease.leaseId, presentation, scene)
                    : await host.apply(layout, endpoint, lease.leaseId, presentation);
            const applied = result.appliedRevision;
            if (!isCurrent()) return;
            if (result.scene) await api.heartbeat(endpointId, lease.leaseId, ++lease.sequence, applied, result.presentation, result.scene);
            else await api.heartbeat(endpointId, lease.leaseId, ++lease.sequence, applied, result.presentation);
            if (!isCurrent()) return;
            authorizedUntil = performance.now() + 6000; failure = '';
            nextPollMs = layout && applied === null && !presentation ? 250 : 3000;
            host.presented?.(layout, endpoint, lease.leaseId, presentation ? null : applied);
            host.status(presentation ? result.presentation?.outcome === 'applied' ? `${presentation.mode === 'frozen' ? '已冻结' : '已黑场'} · ${presentation.wallId}` : '无法冻结：没有完整保留帧，保持黑场'
                : layout ? applied === layout.revision ? `已呈现 · ${layout.wallId} · v${applied}` : '内容尚未应用'
                : `已注册 ${endpointId}，等待 Loom 分配墙面`);
        } catch (error) {
            if (!stopped) invalidate(tileFailure(error));
            await disconnect();
        }
    }
    function schedule() {
        if (stopped) return;
        running = step().finally(() => {
            running = undefined;
            if (!stopped) timer = setTimeout(schedule, nextPollMs);
        });
    }
    return {
        start() { if (!running && !timer && !stopped) { monitor(); schedule(); } },
        async stop() {
            stopped = true; clearTimeout(timer); clearTimeout(monitorTimer); host.clear('terminal_stopped');
            await Promise.all([running, probing?.catch(() => {})]); await disconnect();
        },
    };
}
