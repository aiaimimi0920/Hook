/** Browser pixels are converted once; cross-output and ambiguous multi-touch gestures cancel. */
import { liveMouseButton, liveVirtualKey, liveWheelPayload, releaseLivePointer, tryCaptureLivePointer } from './liveCaptureInput';
import type { createTileInputController } from './tileInputController';

export function bindTileInput(canvas: HTMLCanvasElement, input: ReturnType<typeof createTileInputController>) {
    let pointer: number | undefined;
    let buttons = 0;
    function pixel(clientX: number, clientY: number) {
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || clientX < rect.left || clientY < rect.top
            || clientX >= rect.right || clientY >= rect.bottom) return undefined;
        return { x: Math.floor((clientX - rect.left) * canvas.width / rect.width),
            y: Math.floor((clientY - rect.top) * canvas.height / rect.height) };
    }
    function cancelWithMessage(message = '') {
        const previous = pointer; pointer = undefined; buttons = 0;
        if (previous !== undefined) releaseLivePointer(canvas, previous);
        input.cancel(message);
    }
    function cancel() { cancelWithMessage(); }
    function leave() { cancelWithMessage('操作权已释放；跨屏手势需在目标屏重新按下。'); }
    function pointerEvent(event: PointerEvent) {
        if (!event.isPrimary || !['mouse', 'touch'].includes(event.pointerType)) { cancelWithMessage('无法确认指针身份，已取消手势。'); return; }
        const point = pixel(event.clientX, event.clientY);
        if (!point) { leave(); return; }
        if (pointer !== undefined && pointer !== event.pointerId) { cancelWithMessage('指针身份已改变，已取消手势。'); return; }
        event.preventDefault();
        if (event.type === 'pointermove') {
            input.send({ kind: 'move', pixel: point, pointerId: event.pointerId }); return;
        }
        const button = liveMouseButton(event.button);
        if (!button) return;
        const pressed = event.type === 'pointerdown';
        if (pressed) {
            canvas.focus({ preventScroll: true }); pointer = event.pointerId; buttons |= 1 << event.button;
            tryCaptureLivePointer(canvas, event.pointerId, event.isTrusted);
        }
        input.send({ kind: 'button', pixel: point, pointerId: event.pointerId, button,
            state: pressed ? 'pressed' : 'released', clickCount: event.detail === 2 ? 2 : 1 });
        if (!pressed) {
            buttons &= ~(1 << event.button);
            if (!buttons) { pointer = undefined; releaseLivePointer(canvas, event.pointerId); }
        }
    }
    function wheel(event: WheelEvent) {
        event.preventDefault();
        const point = pixel(event.clientX, event.clientY);
        if (!point) { cancel(); return; }
        const { wheelAxis, wheelDelta } = liveWheelPayload(event);
        if (!wheelDelta) return;
        input.send({ kind: 'wheel', pixel: point, deltaX: wheelAxis === 'horizontal' ? wheelDelta : 0,
            deltaY: wheelAxis === 'vertical' ? wheelDelta : 0 });
    }
    function key(event: KeyboardEvent) {
        if (event.key === 'Escape') { cancel(); return; }
        const virtualKey = liveVirtualKey(event);
        if (virtualKey === undefined) return;
        event.preventDefault();
        input.send({ kind: 'key', virtualKey, state: event.type === 'keydown' ? 'pressed' : 'released' });
    }
    function lostCapture() { if (buttons) cancel(); }
    function hidden() { if (document.hidden) cancel(); }
    function contextMenu(event: Event) { event.preventDefault(); }
    const pointerEvents = ['pointerdown', 'pointerup', 'pointermove'] as const;
    pointerEvents.forEach((name) => canvas.addEventListener(name, pointerEvent));
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('lostpointercapture', lostCapture);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('keydown', key); canvas.addEventListener('keyup', key);
    canvas.addEventListener('contextmenu', contextMenu); canvas.addEventListener('blur', cancel);
    window.addEventListener('blur', cancel); window.addEventListener('pagehide', cancel);
    document.addEventListener('visibilitychange', hidden);
    return () => {
        cancel();
        pointerEvents.forEach((name) => canvas.removeEventListener(name, pointerEvent));
        canvas.removeEventListener('pointercancel', cancel); canvas.removeEventListener('pointerleave', leave);
        canvas.removeEventListener('lostpointercapture', lostCapture); canvas.removeEventListener('wheel', wheel);
        canvas.removeEventListener('keydown', key); canvas.removeEventListener('keyup', key);
        canvas.removeEventListener('contextmenu', contextMenu); canvas.removeEventListener('blur', cancel);
        window.removeEventListener('blur', cancel); window.removeEventListener('pagehide', cancel);
        document.removeEventListener('visibilitychange', hidden);
    };
}
