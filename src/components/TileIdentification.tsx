import { createSignal, onCleanup, onMount } from 'solid-js';
import type { TileIdentificationMarker } from '../services/tileIdentification';
import './TileIdentification.css';

export function TileIdentification(props: { marker: TileIdentificationMarker; dismiss: () => void }) {
    const [seconds, setSeconds] = createSignal(0);
    let panel!: HTMLDivElement;
    onMount(() => {
        const previous = document.activeElement;
        const update = () => setSeconds(Math.max(0, Math.ceil((props.marker.deadline - performance.now()) / 1000)));
        update(); panel.focus();
        const timer = setInterval(update, 250);
        onCleanup(() => {
            clearInterval(timer);
            queueMicrotask(() => {
                if (previous instanceof HTMLElement && previous.isConnected && !previous.closest('[inert]')) previous.focus();
            });
        });
    });
    return <div class="tile-identification" ref={(el) => { panel = el; }} tabIndex={-1} role="dialog" aria-modal="true" aria-label="识别物理屏幕"
        onKeyDown={(event) => { if (event.key === 'Tab') { event.preventDefault(); panel.querySelector('button')?.focus(); } }}>
        <section>
            <p class="tile-identification-kicker">Hook · 物理显示输出</p>
            <h1>{props.marker.endpoint.display?.name}</h1>
            <p>{props.marker.endpoint.pixelSize.width} × {props.marker.endpoint.pixelSize.height} 像素</p>
            <code>{props.marker.endpoint.deviceId}<br />{props.marker.endpoint.outputId}</code>
            <p role="status">识别期间暂停本屏幕输入 · {seconds()} 秒后自动关闭</p>
            <button onClick={() => props.dismiss()}>关闭识别 · Escape</button>
        </section>
    </div>;
}
