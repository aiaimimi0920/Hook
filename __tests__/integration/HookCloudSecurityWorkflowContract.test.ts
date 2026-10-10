import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8").replaceAll("\r\n", "\n");
const signing = source(".github/workflows/signpath-signing.yml");
const release = source(".github/workflows/release-hook-tag.yml");

describe("cloud security release boundaries", () => {
  it("never inserts dispatch inputs into executable signing script source", () => {
    const scripts = [...signing.matchAll(/(?:run|script): \|\n((?:(?: {10,}[^\n]*|)\n)*)/g)];
    expect(scripts.length).toBeGreaterThan(5);
    for (const [, script] of scripts) expect(script).not.toContain("${{ inputs.");
    expect(signing.indexOf("Validate dispatch inputs as data")).toBeLessThan(signing.indexOf("uses: actions/checkout@"));
    expect(signing).toContain("if: github.ref == 'refs/heads/main'");
  });

  it("keeps preflight read-only and binds the privileged checkout/download to authenticated IDs", () => {
    const boundary = signing.indexOf("\n  sign-windows-uiaccess:\n");
    const preflight = signing.slice(0, boundary);
    const privileged = signing.slice(boundary);
    expect(preflight).not.toMatch(/contents: write|SIGNPATH_API_TOKEN/);
    expect(privileged).toContain("needs: validate-candidate");
    expect(privileged).toContain("ref: ${{ needs.validate-candidate.outputs.commit }}");
    expect(privileged).toContain("artifact-ids: ${{ needs.validate-candidate.outputs.artifact-id }}");
    expect(privileged).not.toContain("ref: ${{ inputs.tag }}");
    expect(privileged).toContain("persist-credentials: false");
  });

  it("scans, builds and verifies the same pre-build immutable source on separate runners", () => {
    const build = release.slice(release.indexOf("\n  release:\n"), release.indexOf("\n  publish:\n"));
    const publish = release.slice(release.indexOf("\n  publish:\n"));
    expect(build).toContain("contents: read");
    expect(build).not.toMatch(/contents: write|id-token:|attestations:/);
    for (const job of [build, publish]) expect(job).toContain("ref: ${{ needs.scan-context.outputs.commit }}");
    expect(publish).toContain("artifact-ids: ${{ needs.release.outputs.artifact-id }}");
    expect(publish).toContain("-RequireCleanSource");
    expect(publish.indexOf("Independently verify transferred release evidence")).toBeLessThan(publish.indexOf("Attest release build provenance"));
    expect(publish).not.toMatch(/npm (ci|install|run|test)|cargo (build|test)|-RunSmoke|-RunHeadlessSmoke/);
  });
});
