import assert from 'node:assert/strict';
import path from 'node:path';
import type { Page } from 'playwright';
import { traceNativeInput } from './nativeInputTrace.ts';
import { until, writeJson } from './probeSession.ts';

interface WheelState { keyEdges: number; trackValue: number; trackWheels: number; lastWheelDelta: number }
interface Point { x: number; y: number }

/** Alternate direction to avoid range saturation; every attempt needs a native wheel and value change. */
export async function verifyNativeWheel(page: Page, root: string, action: Point, track: Point,
    fixtureState: () => Promise<WheelState>) {
    const stopTrace = await traceNativeInput(page), samples: unknown[] = [];
    let pending: unknown;
    try {
        for (let index = 0; index < 16; index++) {
            if (index > 0) {
                const keys = (await fixtureState()).keyEdges;
                await page.mouse.move(action.x, action.y);
                await page.keyboard.press('KeyA');
                await until(fixtureState, (value) => value.keyEdges >= keys + 2, 'wheel exercise key edges');
            }
            const before = await fixtureState(), delta = index % 2 === 0 ? 120 : -120;
            pending = { index, before, delta };
            const start = performance.now();
            await page.mouse.move(track.x, track.y); await page.mouse.wheel(0, delta);
            const after = await until(fixtureState, (value) => value.trackValue !== before.trackValue
                && value.trackWheels > before.trackWheels, `native wheel ${index + 1}`);
            assert.equal(after.trackWheels, before.trackWheels + 1, 'one terminal wheel must reach the source exactly once');
            assert.equal(after.lastWheelDelta, -delta);
            assert((after.trackValue - before.trackValue) * delta < 0, 'native slider must follow the requested direction');
            samples.push({ index, before, after, delta, observedMs: performance.now() - start });
            pending = undefined;
        }
        return { samples: samples.length, exactlyOnceNativeWheels: true };
    } finally {
        await writeJson(path.join(root, 'wheel-trace.json'), { track, samples, pending,
            fixture: await fixtureState(), trace: await stopTrace() });
    }
}
