import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { safeInvoke } from '../services/apiTransport';
import { wallApi } from '../services/apiWall';
import { createTilePresenter, tileFailure, type TileOutput } from '../services/tilePresenter';
import { createTileImageRenderer } from '../services/tileImageRenderer';
import { createTileClock } from '../services/tileClock';
import type { WallMediaFormat } from '../services/wallMediaProtocol';
import type { TileRenderMode } from '../services/wallTypes';
import { createTileInputController } from '../services/tileInputController';
import { bindTileInput } from '../services/tileInputEvents';
import { createTileSurfaceController, emptyTileSurfaceModel } from '../services/tileSurfaceController';
import { TileSurfaceControls, TileSurfaceLayers } from './TileSurfaceLayers';
import { createTileIdentification, type TileIdentificationMarker } from '../services/tileIdentification';
import { TileIdentification } from './TileIdentification';
import '../styles/theme-foundation.css';
import './TileTerminal.css';

export default function TileTerminal() {
    const outputMode = location.hash === '#tile-output';
    const [outputs, setOutputs] = createSignal<TileOutput[]>([]);
    const [status, setStatus] = createSignal('等待连接 Loom');
    const [reason, setReason] = createSignal('');
    const [busy, setBusy] = createSignal(false);
    const [inputStatus, setInputStatus] = createSignal('');
    const [surfaceModel, setSurfaceModel] = createSignal(emptyTileSurfaceModel());
    const [marker, setMarker] = createSignal<TileIdentificationMarker | null>(null);
    const [visible, setVisible] = createSignal(false);
    const [format, setFormat] = createSignal<WallMediaFormat>('raw_bgra');
    const [mediaStats, setMediaStats] = createSignal('[]');
    const renderModes: TileRenderMode[] = ['image', 'surface_v1'];
    const clock = createTileClock();
    let canvas!: HTMLCanvasElement;
    let media!: HTMLCanvasElement;
    let disposed = false;
    let unbindInput: (() => void) | undefined;
    let statsTimer: ReturnType<typeof setInterval> | undefined;
    const input = createTileInputController(setInputStatus);
    const surfaces = createTileSurfaceController(setSurfaceModel, () => input.cancel());
    const identification = createTileIdentification(setMarker, () => { input.clear(); surfaces.suspend(); });
    const renderer = createTileImageRenderer(() => canvas, setReason, () => { input.clear(); surfaces.suspend(); }, surfaces, () => media, clock, setVisible);
    const presenter = createTilePresenter({
        clock,
        inputCapabilities: ['pointer', 'wheel', 'keyboard'], renderModes,
        presented: (...args) => { input.update(...args); surfaces.presented(...args); },
        output: () => safeInvoke<TileOutput>('tile_output_info', undefined),
        status: setStatus, clear: (reason) => { identification.clear(); renderer.clear(reason); }, apply: renderer.apply,
        identify: identification.apply,
    });
    async function refresh() {
        if (busy()) return;
        setBusy(true); setReason('');
        try {
            const next = await safeInvoke<TileOutput[]>('tile_list_outputs', undefined);
            if (disposed) return;
            setOutputs(next); setStatus('显示输出已读取；正在验证设备配对...');
            const { deviceId } = await wallApi.readState();
            if (!disposed) setStatus(`Loom 已连接 · ${deviceId}`);
        } catch (error) { if (!disposed) setReason(tileFailure(error)); }
        finally { if (!disposed) setBusy(false); }
    }
    async function launch(id: string) {
        setBusy(true);
        try { await safeInvoke<void>('tile_launch_output', { outputId: id, format: format() }); setStatus('终端已启动；每个输出只允许一个呈现进程。'); }
        catch (error) { setReason(tileFailure(error)); }
        finally { setBusy(false); }
    }
    async function exit() {
        // Native requests are not cancellable; exit remains bounded and the server expires any late lease.
        await Promise.race([Promise.all([input.stop(), presenter.stop()]), new Promise<void>((resolve) => setTimeout(resolve, 1000))]);
        await safeInvoke<void>('tile_exit', undefined);
    }
    function dismissIdentification() { void identification.dismiss().catch((error: unknown) => { if (!disposed) setReason(tileFailure(error)); }); }
    function identificationEscape(event: KeyboardEvent) {
        if (event.key === 'Escape' && outputMode && identification.active()) {
            event.preventDefault(); event.stopImmediatePropagation(); dismissIdentification();
        }
    }
    function escape(event: KeyboardEvent) { if (event.key === 'Escape' && outputMode && !event.defaultPrevented && !surfaceModel().confirmation) void exit(); }
    function blur() { surfaces.suspend(); }
    async function startOutput() {
        try {
            const mode = await safeInvoke<unknown>('tile_media_mode', undefined);
            if (disposed) return;
            if (mode !== 'raw_bgra' && mode !== 'png') throw new Error('tile_media_format_invalid');
            setFormat(mode);
            if (mode === 'raw_bgra') renderModes.push('raw_bgra');
            const base = bindTileInput(canvas, input), overlay = bindTileInput(media, input);
            unbindInput = () => { base(); overlay(); }; window.addEventListener('blur', blur); presenter.start();
            statsTimer = setInterval(() => setMediaStats(JSON.stringify(renderer.mediaStats())), 1000);
        } catch (error) { if (!disposed) setReason(tileFailure(error)); }
    }
    onMount(() => {
        document.addEventListener('keydown', identificationEscape, true); document.addEventListener('keydown', escape);
        if (outputMode) void startOutput();
        else void refresh();
    });
    onCleanup(() => { disposed = true; clearInterval(statsTimer); identification.clear(); unbindInput?.(); window.removeEventListener('blur', blur); document.removeEventListener('keydown', identificationEscape, true); document.removeEventListener('keydown', escape); void input.stop(); void presenter.stop(); });
    return <Show when={outputMode} fallback={<main class="tile-control">
        <header><h1>Hook 瓷砖终端</h1><button disabled={busy()} onClick={() => void refresh()}>刷新输出与配对</button></header>
        <p>每块屏幕独立呈现，由 Loom 管理墙面布局。终端复用 LOOM_MANIFEST_PATH 指定的连接配置；首次配对请在 Loom 设备页批准。</p>
        <p role="status">{status()}</p><Show when={reason()}><p role="alert" class="tile-error">{reason()}</p></Show>
        <label class="tile-media-choice">新输出的 Live 画面
            <select value={format()} disabled={busy()} onChange={(event) => setFormat(event.currentTarget.value === 'png' ? 'png' : 'raw_bgra')}>
                <option value="raw_bgra">原始 BGRA · 原始尺寸 · 最高 30 fps</option>
                <option value="png">低带宽 PNG · 最高 640 × 360 · 10 fps</option>
            </select>
        </label>
        <p>PNG 通路由 Loom 缩放和编码。这里选择新启动输出的能力，已运行输出需退出后重新启动。</p>
        <Show when={!outputs().length}><p>没有可绑定的 Windows 显示输出；需要操作系统提供稳定的显示设备接口。</p></Show>
        <For each={outputs()}>{(output) => <section class="tile-output-row">
            <strong>{output.name}</strong><code>{output.outputId}</code>
            <span>{output.width} × {output.height} · ({output.x}, {output.y})</span>
            <button disabled={busy()} onClick={() => void launch(output.outputId)}>在此屏幕启动</button>
        </section>}</For>
        <p>支持图片、Hook Live 和声明式 Art Surface。Live 点击、拖动、滚轮和键盘经过 Loom 回源；Art 操作复用实例、确认和取消合同。未支持的 Art 运行时会显示原因。输出窗口按 Escape 退出，关闭管理窗口不停止输出。</p>
    </main>}>
        <main class="tile-output" data-media-mode={format()} data-media-stats={mediaStats()}>
            <div class="tile-output-content" inert={marker() !== null}>
            <div style={{ display: 'contents', visibility: visible() ? 'visible' : 'hidden' }} inert={!visible()}>
            <canvas ref={(el) => { canvas = el; }} tabIndex={0} aria-label="交互屏幕墙" style={{ 'touch-action': 'none' }} />
            <TileSurfaceLayers model={surfaceModel()} controller={surfaces} canvas={() => canvas} />
            <svg class="tile-clip-definitions" aria-hidden="true"><defs><clipPath id="tile-media-clip" clipPathUnits="objectBoundingBox">
                <For each={[...surfaceModel().mediaClips.values()].flat()}>{(rect) => <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} />}</For>
            </clipPath></defs></svg>
            <canvas ref={(el) => { media = el; }} class="tile-media-plane" tabIndex={0} aria-label="上层交互画面" style={{ 'touch-action': 'none', 'clip-path': 'url(#tile-media-clip)' }} />
            </div>
            <Show when={reason()}><p class="tile-output-reason" role="status">{reason()}</p></Show>
            <Show when={!reason() && inputStatus()}><p class="tile-input-status" role="status">{inputStatus()}</p></Show>
            <TileSurfaceControls model={surfaceModel()} controller={surfaces} />
            </div>
            <Show when={marker()} keyed>{(active) => <TileIdentification marker={active} dismiss={dismissIdentification} />}</Show>
        </main>
    </Show>;
}
