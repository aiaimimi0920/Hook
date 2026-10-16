import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appSource = readFileSync(resolve(process.cwd(), "src/app/app.tsx"), "utf8");
const artControlSource = readFileSync(
    resolve(process.cwd(), "src/app/appArtControlListeners.ts"),
    "utf8",
);
const startupSource = readFileSync(
    resolve(process.cwd(), "src/app/appStartupLifecycle.ts"),
    "utf8",
);
const workflowBoundarySources = `${appSource}\n${artControlSource}\n${startupSource}`;

describe("Otter workflow payload boundary", () => {
    it("normalizes unknown IPC/browser workflow payloads before instantiating units", () => {
        expect(artControlSource).toContain("normalizeWorkflowSnapshotPayload(event.payload)");
        expect(startupSource).toContain("normalizeWorkflowSnapshotPayload(payload)");
        expect(workflowBoundarySources).not.toContain("nodes?: any[]");
        expect(workflowBoundarySources).not.toContain("edges?: any[]");
        expect(workflowBoundarySources).not.toContain("event.payload as any");
    });
});
