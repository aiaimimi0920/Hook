import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const appSource = fs.readFileSync(path.join(root, "src/app.tsx"), "utf8");
const clientSource = fs.readFileSync(path.join(root, "src/services/client.ts"), "utf8");
const cargoSource = fs.readFileSync(path.join(root, "src-tauri/Cargo.toml"), "utf8");
const connectorSource = fs.readFileSync(
    path.join(root, "src-tauri/src/loom_connector.rs"),
    "utf8",
);
const hookSource = fs.readFileSync(path.join(root, "src-tauri/src/loom_hook.rs"), "utf8");

describe("remote Surface activation contract", () => {
    it("enables the paired remote client while retaining an explicit loopback-only build", () => {
        expect(cargoSource).toContain('default = ["remote-surface"]');
        expect(cargoSource).toContain("remote-surface = []");
        expect(connectorSource).toContain("classify_loom_base_url");
        expect(connectorSource).toContain('("https", false) => Ok(LoomBaseUrlKind::RemoteHttps)');
        expect(connectorSource).not.toContain('starts_with("http://127.0.0.1:")');
        expect(hookSource).not.toContain('starts_with("http://localhost:")');
    });

    it("clears stale Surface state before consuming a reset batch", () => {
        expect(hookSource).toContain('"surface/reset"');
        expect(hookSource.indexOf('"surface/reset"')).toBeLessThan(
            hookSource.indexOf("for message in messages"),
        );
        expect(clientSource).toContain('listen<SurfaceResetDelivery>("surface/reset"');

        const resetStart = appSource.indexOf("const unlistenSurfaceReset");
        const snapshotStart = appSource.indexOf("const unlistenSurfaceSnapshot", resetStart);
        const resetBlock = appSource.slice(resetStart, snapshotStart);
        expect(resetBlock).toContain("surfaceStore.actions.clearAll()");
        expect(resetBlock).toContain("surfaceResourceStore.actions.clearAll()");
        expect(resetBlock).toContain("surfaceAttachmentRequests.clearAll()");
        expect(resetBlock).toContain("setSurfaceConfirmations([])");
    });
});
