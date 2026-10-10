import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
const root = resolve(process.cwd(), ".github/workflows");
const read = (name: string) => readFileSync(resolve(root, name), "utf8").replaceAll("\r\n", "\n");
const release = read("release-hook-tag.yml");
const dependency = read("dependency-security.yml");
const releaseJob = release.slice(release.indexOf("\n  release:\n"));
const scanJobs = release.slice(release.indexOf("\njobs:\n"), release.indexOf("\n  release:\n"));
const gate = releaseJob.match(/if: \$\{\{ (.+) \}\}/)![1].replaceAll("needs.scan-context", "needs['scan-context']");
function permitted(event: string, publish: string, scanOnly: unknown, tag = "V1.2.3", refType = "branch") {
  return runInNewContext(gate, { needs: { "scan-context": { outputs: { publish } } }, github: { event_name: event, ref_type: refType }, inputs: { "scan-only": scanOnly, tag }, toJSON: JSON.stringify }, { timeout: 100 });
}
describe("Hook release scan-only maintenance contract", () => {
  it("blocks PR/main/maintenance publication even if a context output is incorrectly true", () => {
    for (const output of ["false", "true"]) {
      expect(permitted("pull_request", output, false)).toBe(false);
      expect(permitted("push", output, false)).toBe(false);
      expect(permitted("workflow_dispatch", output, true)).toBe(false);
      for (const absent of [undefined, null, "", "false", 0]) expect(permitted("workflow_dispatch", output, absent)).toBe(false);
    }
    expect(permitted("workflow_dispatch", "true", false, "")).toBe(false);
    expect(permitted("workflow_dispatch", "false", false)).toBe(false);
    expect(permitted("workflow_dispatch", "true", false)).toBe(true);
    expect(permitted("push", "true", undefined, "", "tag")).toBe(true);
  });
  it("validates release context and requires both classifier and scan success", () => {
    expect(scanJobs).toContain("node .github/scripts/security-run-context.cjs");
    expect(scanJobs).toContain("security-mode: ${{ needs.scan-context.outputs.mode }}");
    expect(scanJobs).toContain("checkout-ref: ${{ needs.scan-context.outputs.commit }}");
    expect(releaseJob).toContain("needs: [scan-context, dependency-security]");
    expect(gate).not.toMatch(/always\(|failure\(|cancelled\(/);
    expect(releaseJob).toContain("if ($tag -notmatch '^[vV]\\d+\\.\\d+\\.\\d+$') { throw");
    expect(releaseJob.indexOf("if ($tag -notmatch")).toBeLessThan(releaseJob.indexOf("Setup Node.js"));
    expect(release).toContain("cancel-in-progress: false");
  });
  it("grants publishing authority only after the unprivileged build succeeds", () => {
    expect(scanJobs).not.toMatch(/contents: write|id-token:|attestations:/);
    const buildJob = releaseJob.slice(0, releaseJob.indexOf("\n  publish:\n"));
    const publishJob = releaseJob.slice(releaseJob.indexOf("\n  publish:\n"));
    expect(buildJob).not.toMatch(/contents: write|id-token:|attestations:/);
    expect(publishJob).toContain("needs: [scan-context, release]");
    expect(publishJob).not.toMatch(/npm (ci|install|test|run)|cargo (test|build)|-RunHeadlessSmoke/);
    expect(releaseJob).toContain("contents: write\n      id-token: write\n      attestations: write");
    for (const name of ["Build formal Hook release", "Build reviewed UIAccess signing candidate", "Attest release build provenance", "Attest release SBOM", "Create verified draft release", "Verify assets and publish draft release", "Remove failed draft release"]) expect(releaseJob).toContain(`name: ${name}`);
    expect(releaseJob).toContain("if: always()");
    expect(releaseJob).toContain("if: failure() && steps.draft-release.outputs.id != ''");
    expect([...scanJobs.matchAll(/^ {2}([\w-]+):$/gm)].map(m => m[1])).toEqual(["scan-context", "dependency-security"]);
  });
  it("retains the existing caller and leaf scan identity with complete reports", () => {
    expect(scanJobs).toContain("uses: ./.github/workflows/dependency-security.yml");
    expect(dependency).toContain("\n  osv-scan:\n");
    expect(dependency).toContain("ref: ${{ inputs.checkout-ref || github.ref }}");
    expect(dependency).toContain("upload-sarif@");
    expect(dependency).toContain("wait-for-processing: true");
    expect(dependency).toContain("evaluate-osv-result.cjs");
    expect(dependency).toContain("if-no-files-found: error");
    expect(dependency).not.toMatch(/category:|continue-on-error:/);
    expect(release).toContain("pull_request:");
    expect(release).toContain("branches: [main]");
  });
  it("keeps strict release checks and no completion-triggered signing/publication", () => {
    for (const command of ["npm run lint && npm run typecheck && npm run typecheck:test", "npm run audit:licenses", "cargo fmt --check", "npm run check:effective-lines"]) expect(releaseJob).toContain(command);
    for (const file of readdirSync(root).filter(name => name.endsWith(".yml"))) expect(read(file), file).not.toContain("workflow_run:");
    expect(read("signpath-signing.yml")).not.toMatch(/\n {2}(?:push|release|workflow_call|repository_dispatch):/);
  });
});
