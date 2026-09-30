// Spatial variation in every frame avoids depending on testsrc2 animation phase.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

export const videoFixtureFilter = "nullsrc=size=640x360:rate=60," +
    "geq=lum='16+219*mod(X+3*N,128)/127':" +
    "cb='16+224*mod(Y+N,128)/127':cr='16+224*mod(X+Y+2*N,128)/127'";
const frameBytes = 640 * 360 * 3;

export function centralColorCounts(rgb: Buffer): number[] {
    assert.equal(rgb.length, frameBytes);
    const counts: number[] = [];
    for (const y0 of [72, 136, 200]) for (const x0 of [128, 192, 256]) {
        const colors = new Set<number>();
        for (let y = y0; y < y0 + 80; y += 4) for (let x = x0; x < x0 + 128; x += 4) {
            const i = (y * 640 + x) * 3;
            colors.add((Math.floor(rgb[i] / 32) << 6) | (Math.floor(rgb[i + 1] / 32) << 3) | Math.floor(rgb[i + 2] / 32));
        }
        counts.push(colors.size);
    }
    return counts;
}

export async function verifyVideoFixture(video: string) {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", video,
        "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let pending: Buffer = Buffer.alloc(0);
    let stderr = "", previous = "", frames = 0, changedFrames = 0, minimumColors = 512;
    child.stderr.on("data", (data: Buffer) => { stderr = (stderr + data.toString()).slice(-8192); });
    child.stdout.on("data", (data: Buffer) => {
        pending = Buffer.concat([pending, data]);
        while (pending.length >= frameBytes) {
            const frame = pending.subarray(0, frameBytes);
            pending = pending.subarray(frameBytes);
            frames++;
            if (frames > 480) { child.kill(); continue; }
            minimumColors = Math.min(minimumColors, ...centralColorCounts(frame));
            const hash = createHash("sha256").update(frame).digest("hex");
            if (previous && hash !== previous) changedFrames++;
            previous = hash;
        }
    });
    const timer = setTimeout(() => child.kill(), 30000);
    try {
        const code = await new Promise<number | null>((resolve, reject) => {
            child.on("error", reject); child.on("close", resolve);
        });
        assert.equal(code, 0, stderr);
        assert.equal(frames, 480, "Fixture must have exactly eight seconds of 60 FPS video");
        assert.equal(pending.length, 0, "Decoded fixture frame was truncated");
        assert(minimumColors > 12, `Fixture itself violates the native color oracle: ${minimumColors}`);
        assert.equal(changedFrames, 479, "Fixture must change on every decoded frame");
        return { frames, changedFrames, minimumColors, sampledRegionsPerFrame: 9 };
    } finally { clearTimeout(timer); }
}
