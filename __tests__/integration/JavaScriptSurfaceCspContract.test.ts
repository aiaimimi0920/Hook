import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const componentSource = readFileSync(
    resolve(process.cwd(), "src/components/JavaScriptSurface.tsx"),
    "utf8",
);
const bootstrapSource = readFileSync(
    resolve(process.cwd(), "public/javascript-surface-bootstrap.js"),
    "utf8",
);
const hostSource = readFileSync(
    resolve(process.cwd(), "public/javascript-surface-host.html"),
    "utf8",
);
const tauriConfig = JSON.parse(
    readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
) as { app?: { security?: { csp?: string } } };

describe("JavaScript Surface CSP contract", () => {
    it("loads a fixed same-origin sandbox host without widening the main CSP", () => {
        expect(componentSource).toContain('"/javascript-surface-host.html"');
        expect(componentSource).toContain("src={documentUrl}");
        expect(componentSource).not.toContain("srcdoc={source()}");
        expect(componentSource).not.toContain("buildJavaScriptSurfaceDocument");
        expect(componentSource).not.toContain("javascriptSurfaceBootstrap.js?raw");
        expect(componentSource).not.toContain("URL.createObjectURL");
        expect(componentSource).toContain("entryBase64: entry.base64");
        expect(hostSource).toContain("script-src 'self' blob:");
        expect(hostSource).toContain('src="/javascript-surface-bootstrap.js"');
        expect(bootstrapSource).toContain("event.data.entryBase64");
        expect(bootstrapSource).toContain("URL.createObjectURL(new Blob([bytes]");
        expect(tauriConfig.app?.security?.csp).toContain("frame-src 'self'");
        expect(tauriConfig.app?.security?.csp).toContain("frame-ancestors 'self'");
        expect(tauriConfig.app?.security?.csp).not.toContain("frame-ancestors 'none'");
        expect(tauriConfig.app?.security?.csp).toContain("script-src 'self'");
        expect(tauriConfig.app?.security?.csp).not.toContain("frame-src 'self' blob:");
        expect(tauriConfig.app?.security?.csp).not.toContain("script-src 'self' blob:");
        expect(tauriConfig.app?.security?.csp).not.toContain("script-src 'self' 'unsafe-inline'");
    });
});
