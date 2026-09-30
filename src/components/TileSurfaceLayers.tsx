import { For, Show, createSignal, createUniqueId, onCleanup, onMount } from 'solid-js';
import { DeclarativeSurface } from './DeclarativeSurface';
import { SurfaceConfirmationDialog } from './SurfaceConfirmationDialog';
import type { createTileSurfaceController, TileSurfaceModel } from '../services/tileSurfaceController';
import { tileSurfaceMatrix, type TileSurfaceLayer } from '../services/tileSurfaceGeometry';
import type { WallSurfaceAnchor } from '../services/apiWallSurfaces';
import './TileSurfaceLayers.css';

interface Props {
    model: TileSurfaceModel;
    controller: ReturnType<typeof createTileSurfaceController>;
    canvas: () => HTMLCanvasElement;
}

function ArtLayer(props: Props & { layer: TileSurfaceLayer; clipId: string; size: { width: number; height: number } }) {
    let element!: HTMLDivElement;
    let anchor: WallSurfaceAnchor | undefined;
    const state = () => props.model.states.get(props.layer.placement.source.id);
    function pixel(clientX: number, clientY: number) {
        const canvas = props.canvas(), rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height || clientX < rect.left || clientY < rect.top || clientX >= rect.right || clientY >= rect.bottom) return;
        return { x: Math.floor((clientX - rect.left) * canvas.width / rect.width), y: Math.floor((clientY - rect.top) * canvas.height / rect.height) };
    }
    function pointer(event: PointerEvent) {
        const point = pixel(event.clientX, event.clientY);
        anchor = point && event.isPrimary && ['mouse', 'touch'].includes(event.pointerType)
            ? props.controller.activate(props.layer, point) : undefined;
        if (!anchor) { event.preventDefault(); event.stopImmediatePropagation(); }
    }
    function focus(event: FocusEvent) {
        if (!(event.target instanceof HTMLElement)) return;
        const canvas = props.canvas().getBoundingClientRect(), target = event.target.getBoundingClientRect();
        anchor = undefined;
        for (const clip of props.layer.inputClips) {
            const left = Math.max(target.left, canvas.left + clip.x * canvas.width), top = Math.max(target.top, canvas.top + clip.y * canvas.height);
            const right = Math.min(target.right, canvas.left + (clip.x + clip.width) * canvas.width), bottom = Math.min(target.bottom, canvas.top + (clip.y + clip.height) * canvas.height);
            if (right <= left || bottom <= top) continue;
            const point = pixel((left + right) / 2, (top + bottom) / 2);
            if (point) anchor = props.controller.activate(props.layer, point);
            if (anchor) break;
        }
        if (!anchor) event.target.blur();
    }
    onMount(() => {
        element.addEventListener('pointerdown', pointer, true);
        element.addEventListener('focusin', focus, true);
        onCleanup(() => { element.removeEventListener('pointerdown', pointer, true); element.removeEventListener('focusin', focus, true); });
    });
    return <div ref={element} class="tile-art-clip" style={{ 'clip-path': `url(#${props.clipId})` }}>
        <Show when={state()}>{(current) => <div class="tile-art-viewport" style={{ width: `${current().width}px`, height: `${current().height}px`,
            transform: `matrix(${tileSurfaceMatrix(props.layer.projection, current().width, current().height, props.size.width, props.size.height).join(',')})` }}>
            <DeclarativeSurface unitId={`tile:${props.layer.placement.placementId}`} snapshot={current().snapshot} generation={current().generation}
                interactive={props.model.active && props.layer.placement.interactive && !props.model.confirmation}
                resolveResource={(id) => { void props.model.version; return props.controller.resource(id); }}
                onEvent={(event) => props.controller.send(props.layer, anchor, event)} />
        </div>}</Show>
    </div>;
}

export function TileSurfaceLayers(props: Props) {
    const id = createUniqueId();
    const [size, setSize] = createSignal({ width: 0, height: 0 });
    onMount(() => {
        const canvas = props.canvas();
        const update = () => { const rect = canvas.getBoundingClientRect(); setSize({ width: rect.width, height: rect.height }); };
        const observer = new ResizeObserver(update); observer.observe(canvas); update(); onCleanup(() => observer.disconnect());
    });
    return <div class="tile-art-plane" aria-busy={props.model.editing}>
        <svg class="tile-clip-definitions" aria-hidden="true"><defs>
            <For each={props.model.layers}>{(layer, index) => <clipPath id={`${id}-${index()}`} clipPathUnits="objectBoundingBox">
                <For each={layer.clips}>{(clip) => <rect x={clip.x} y={clip.y} width={clip.width} height={clip.height} />}</For>
            </clipPath>}</For>
        </defs></svg>
        <For each={props.model.layers}>{(layer, index) => <ArtLayer {...props} layer={layer} clipId={`${id}-${index()}`} size={size()} />}</For>
    </div>;
}

export function TileSurfaceControls(props: Pick<Props, 'model' | 'controller'>) {
    return <>
        <Show when={props.model.active && !props.model.confirmation}>
            <div class="tile-art-actions">
                <For each={[...props.model.states.values()].flatMap((state) => state.pending.filter((item) => item.cancelable)
                    .map((item) => ({ ...item, instanceId: state.view.instanceId }))).slice(0, 4)}>{(pending) =>
                    <button disabled={props.model.submitting || pending.ack.status === 'cancel_requested'}
                        onClick={() => void props.controller.cancel(pending.instanceId, pending.ack.requestId)}>取消 {pending.actionId}</button>
                }</For>
                <Show when={props.model.notice}><p role="status">{props.model.notice}</p></Show>
            </div>
        </Show>
        <Show when={props.model.confirmation}>{(pending) => <SurfaceConfirmationDialog request={pending().request}
            submitting={props.model.submitting} error={props.model.notice} onDecision={(approved) => void props.controller.decide(approved)} />}</Show>
    </>;
}
