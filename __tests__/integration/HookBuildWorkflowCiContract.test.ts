import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflowSource = readFileSync(
    resolve(process.cwd(), ".github/workflows/build-hook-exe.yml"),
    "utf8",
);

describe("Hook build workflow CI contract", () => {
    it("uses immutable node24-compatible GitHub action revisions", () => {
        expect(workflowSource).toContain('uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1');
        expect(workflowSource).toContain('uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020');
        expect(workflowSource).toContain('uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a');
        expect(workflowSource).toContain('uses: dtolnay/rust-toolchain@a5f673d0ba8626c3977bb416a1612774bc82181b');
        expect(workflowSource).toContain('uses: Swatinem/rust-cache@6323deb102c322ba6fcbdcafc7e3dddab59af2b6');
        expect(workflowSource).not.toContain('node-version: "20"');
        expect(workflowSource).toContain('node-version: "22"');
    });

    it("runs the ordinary Hook build on main pushes and pull requests, not release tags", () => {
        expect(workflowSource).toContain("push:");
        expect(workflowSource).toContain("pull_request:");
        expect(workflowSource).toContain("branches:");
        expect(workflowSource).toContain("- main");
        expect(workflowSource).not.toContain("tags:");
    });

    it("requires parallel source verification before promoting the native candidate", () => {
        const source = workflowSource.replaceAll("\r\n", "\n");
        const job = (name: string) => {
            const match = source.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`, "m"));
            expect(match, `missing job ${name}`).not.toBeNull();
            return match![1];
        };
        const primaryJob = job("build-windows-candidate");
        const frontendJob = job("frontend-serial");
        const aggregateJob = job("build-windows-exe");
        expect(primaryJob).toContain("fetch-depth: 0");
        expect(primaryJob).toContain("components: rustfmt");
        expect(frontendJob).toContain("run: npm run test:effective-lines");
        expect(workflowSource).not.toContain("run: npm run check:effective-lines");
        expect(frontendJob).toContain("run: npm run typecheck");
        expect(frontendJob).toContain("run: npm run typecheck:test");
        expect(frontendJob).toContain("run: npm test");
        expect(workflowSource).not.toContain("run: cargo fmt --check");
        expect(primaryJob).toContain("run-rust-tests-ci.ps1");
        expect(primaryJob.indexOf("run-rust-tests-ci.ps1")).toBeLessThan(
            primaryJob.indexOf("Build portable Hook EXE"),
        );
        expect(primaryJob).toContain("name: hook-build-candidate");
        expect(primaryJob).not.toContain("name: hook-portable-windows-x64");
        expect(frontendJob).not.toContain("needs:");
        expect(primaryJob).not.toContain("needs:");
        expect(aggregateJob).toContain("needs: [frontend-serial, build-windows-candidate, parallel-race]");
        expect(aggregateJob).toContain("if: ${{ always() }}");
        for (const result of ["FRONTEND", "BUILD", "PARALLEL"]) {
            expect(aggregateJob).toContain(`test "$${result}" = success`);
        }
        expect(aggregateJob.indexOf('test "$PARALLEL" = success')).toBeLessThan(
            aggregateJob.indexOf("Download same-run candidate"),
        );
        expect(aggregateJob).toContain("name: hook-portable-windows-x64");
        expect(aggregateJob).not.toMatch(/run-id:|repository:|github-token:/);
    });
});
