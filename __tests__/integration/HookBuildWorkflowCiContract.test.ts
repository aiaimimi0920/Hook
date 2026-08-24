import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflowSource = readFileSync(
    resolve(process.cwd(), ".github/workflows/build-hook-exe.yml"),
    "utf8",
);

describe("Hook build workflow CI contract", () => {
    it("uses immutable node24-compatible GitHub action revisions", () => {
        expect(workflowSource).toContain('uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09');
        expect(workflowSource).toContain('uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38');
        expect(workflowSource).toContain('uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a');
        expect(workflowSource).toContain('uses: dtolnay/rust-toolchain@a5f673d0ba8626c3977bb416a1612774bc82181b');
        expect(workflowSource).toContain('uses: Swatinem/rust-cache@6323deb102c322ba6fcbdcafc7e3dddab59af2b6');
        expect(workflowSource).not.toContain('node-version: "20"');
        expect(workflowSource).toContain('node-version: "22"');
    });

    it("keeps the ordinary Hook build workflow scoped to main branch pushes", () => {
        expect(workflowSource).toContain("push:");
        expect(workflowSource).toContain("branches:");
        expect(workflowSource).toContain("- main");
        expect(workflowSource).not.toContain("tags:");
    });

    it("runs effective-line, type, frontend, and Rust verification before packaging", () => {
        expect(workflowSource).toContain("components: rustfmt");
        expect(workflowSource).toContain("run: npm run test:effective-lines");
        expect(workflowSource).toContain("run: npm run check:effective-lines");
        expect(workflowSource).toContain("run: npm run typecheck");
        expect(workflowSource).toContain("run: npm test");
        expect(workflowSource).toContain("run: cargo fmt --check");
        expect(workflowSource).toContain("run-rust-tests-ci.ps1");
        expect(workflowSource.indexOf("run: npm run typecheck")).toBeLessThan(
            workflowSource.indexOf("Build portable Hook EXE"),
        );
        expect(workflowSource.indexOf("run: npm run check:effective-lines")).toBeLessThan(
            workflowSource.indexOf("Build portable Hook EXE"),
        );
        expect(workflowSource.indexOf("run-rust-tests-ci.ps1")).toBeLessThan(
            workflowSource.indexOf("Build portable Hook EXE"),
        );
    });
});
