import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const componentSource = readFileSync(
    resolve(process.cwd(), "src/components/JavaScriptSurface.tsx"),
    "utf8",
);
const tauriConfig = JSON.parse(
    readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
) as { app?: { security?: { csp?: string } } };

describe("JavaScript Surface CSP contract", () => {
    it("loads the sandbox document from an allowed local blob URL", () => {
        expect(componentSource).toContain('URL.createObjectURL(new Blob([source], { type: "text/html" }))');
        expect(componentSource).toContain("URL.revokeObjectURL(url)");
        expect(componentSource).toContain("src={source()}");
        expect(componentSource).not.toContain("srcdoc={source()}");
        expect(tauriConfig.app?.security?.csp).toContain("frame-src 'self' blob:");
        expect(tauriConfig.app?.security?.csp).not.toContain("script-src 'self' 'unsafe-inline'");
    });
});
