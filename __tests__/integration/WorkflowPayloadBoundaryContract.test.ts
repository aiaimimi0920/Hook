import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appSource = readFileSync(resolve(process.cwd(), "src/app.tsx"), "utf8");

describe("Hook workflow payload boundary", () => {
    it("normalizes unknown IPC/browser workflow payloads before instantiating units", () => {
        expect(appSource).toContain("normalizeWorkflowSnapshotPayload(event.payload)");
        expect(appSource).toContain("normalizeWorkflowSnapshotPayload(payload)");
        expect(appSource).not.toContain("nodes?: any[]");
        expect(appSource).not.toContain("edges?: any[]");
        expect(appSource).not.toContain("event.payload as any");
    });
});
