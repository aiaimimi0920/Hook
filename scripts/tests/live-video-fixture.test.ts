import assert from "node:assert/strict";
import { test } from "node:test";
import { centralColorCounts } from "./live-video-fixture.ts";

test("fixture oracle rejects black and solid-color frames", () => {
    assert(centralColorCounts(Buffer.alloc(640 * 360 * 3)).every(count => count === 1));
    assert(centralColorCounts(Buffer.alloc(640 * 360 * 3, 255)).every(count => count === 1));
});

test("fixture color quantization uses integer floor and only sampled regions", () => {
    const pixels = Buffer.alloc(640 * 360 * 3);
    pixels[(72 * 640 + 128) * 3] = 31;
    assert(centralColorCounts(pixels).every(count => count === 1));
    pixels[(72 * 640 + 128) * 3] = 32;
    assert.equal(centralColorCounts(pixels)[0], 2);
    assert.throws(() => centralColorCounts(Buffer.alloc(3)));
});
