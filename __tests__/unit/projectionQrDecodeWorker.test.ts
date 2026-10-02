// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { beforeEach, expect, it, vi } from "vitest";
import type jsQR from "jsqr";

const decode = vi.fn<typeof jsQR>();
const source = readFileSync(resolve("src/services/projectionQrDecode.worker.ts"), "utf8");
const workerScript = transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
let worker: { onmessage?: (event: MessageEvent<unknown>) => void; postMessage: ReturnType<typeof vi.fn> };
const valid = () => ({ pixels: new Uint8ClampedArray(4), width: 1, height: 1 });
const detachedPixels = new Uint8ClampedArray(4);
structuredClone(detachedPixels, { transfer: [detachedPixels.buffer] });
const dispatch = (data: unknown) => worker.onmessage!(new MessageEvent("message", { data }));

beforeEach(() => {
    decode.mockReset();
    worker = { postMessage: vi.fn() };
    // Simulate a worker with the real source in an isolated global scope;
    // this does not exercise browser scheduling or Vite's worker loader.
    const context = createContext({ self: worker, Uint8ClampedArray, exports: {}, require: (name: string) => {
        if (name !== "jsqr") throw new Error(`Unexpected worker dependency: ${name}`);
        return decode;
    } });
    runInContext(workerScript, context, { filename: "projectionQrDecode.worker.ts" });
});

it.each([
    null, undefined, 1, "pixels", [], {},
    { width: 1, height: 1 },
    { ...valid(), pixels: null },
    { ...valid(), pixels: [0, 0, 0, 0] },
    { ...valid(), pixels: "0000" },
    { ...valid(), pixels: new Uint8Array(4) },
    { ...valid(), pixels: detachedPixels },
    { ...valid(), pixels: { length: 4 } },
    { ...valid(), pixels: new Uint8ClampedArray(3) },
    { ...valid(), width: "1" },
    { ...valid(), width: 0 },
    { ...valid(), height: -1 },
    { ...valid(), width: 1.5 },
    { ...valid(), height: NaN },
    { ...valid(), width: Infinity },
    { ...valid(), width: 1537 },
    { ...valid(), height: 1537 },
])("returns a controlled failure for malformed data %#", (data) => {
    expect(() => dispatch(data)).not.toThrow();
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ error: "projection_invalid_image" });
    expect(decode).not.toHaveBeenCalled();
});

it("decodes valid transferred pixel data after a malformed request", () => {
    dispatch(null);
    const original = valid();
    const request = structuredClone(original, { transfer: [original.pixels.buffer] });
    expect(original.pixels.byteLength).toBe(0);
    decode.mockReturnValue({ data: "decoded invitation" } as NonNullable<ReturnType<typeof jsQR>>);
    dispatch(request);
    expect(decode).toHaveBeenCalledExactlyOnceWith(request.pixels, 1, 1);
    expect(worker.postMessage).toHaveBeenLastCalledWith({ text: "decoded invitation" });
});

it("preserves not-found and decoder exception responses", () => {
    decode.mockReturnValueOnce(null).mockImplementationOnce(() => { throw new Error("decoder failed"); });
    dispatch(valid()); dispatch(valid());
    expect(worker.postMessage.mock.calls).toEqual([
        [{ error: "projection_qr_not_found" }], [{ error: "projection_invalid_image" }],
    ]);
});

it("accepts the exact dimension budget", () => {
    const pixels = new Uint8ClampedArray(1536 * 1536 * 4);
    decode.mockReturnValue(null);
    dispatch({ pixels, width: 1536, height: 1536 });
    // Avoid eagerly formatting a 9 MiB typed array in the mock-call matcher.
    expect(decode).toHaveBeenCalledTimes(1);
    expect(decode.mock.calls[0][0] === pixels).toBe(true);
    expect(decode.mock.calls[0].slice(1)).toEqual([1536, 1536]);
});
