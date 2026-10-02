import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// Protect the maintenance path at the workflow/job boundary, including reusable scans.
const workflowRoot = resolve(process.cwd(), ".github/workflows");
const readWorkflow = (name: string) => readFileSync(resolve(workflowRoot, name), "utf8");
const release = readWorkflow("release-hook-tag.yml");
const dependency = readWorkflow("dependency-security.yml");
const jobs = release.slice(release.indexOf("\njobs:\n"));
const releaseJob = jobs.slice(jobs.indexOf("\n  release:\n"));
const scanJob = jobs.slice(0, jobs.indexOf("\n  release:\n"));

function expressionAfter(source: string, key: string): string {
  const lines = source.split("\n").filter((line) => line.trimStart().startsWith(`${key}:`));
  expect(lines).toHaveLength(1);
  const match = lines[0].match(/\$\{\{\s*(.*?)\s*\}\}/);
  expect(match).not.toBeNull();
  return match![1];
}

const gate = expressionAfter(releaseJob.split("    steps:")[0], "if");
const checkoutRef = expressionAfter(scanJob, "checkout-ref");
const concurrency = expressionAfter(release.split("\npermissions:")[0], "group");

function context(event: string, scanOnly?: boolean, tag = "V0.2.32") {
  return {
    github: {
      event_name: event,
      ref: event === "push" ? "refs/tags/V0.2.32" : "refs/heads/main",
      ref_name: event === "push" ? "V0.2.32" : "main",
      sha: "f".repeat(40),
    },
    // GitHub preserves typed booleans in inputs; absent properties evaluate as empty strings.
    inputs: { "scan-only": scanOnly ?? "", tag: event === "push" ? "" : tag },
  };
}

function evaluate(expression: string, values: ReturnType<typeof context>): unknown {
  // These expressions deliberately use only operators with matching JS/Actions semantics.
  // Read the actual workflow expression instead of duplicating its decision in the test.
  return runInNewContext(expression, values, { timeout: 100 });
}

describe("Hook release scan-only maintenance contract", () => {
  it("requires an explicit typed opt-in and lets maintenance omit the publication tag", () => {
    expect(release).toMatch(/scan-only:\n\s+description: [^\n]+\n\s+required: false\n\s+type: boolean\n\s+default: false/);
    expect(release).toMatch(/tag:\n\s+description: [^\n]+\n\s+required: false\n\s+type: string/);
    expect(gate).toBe("!inputs['scan-only']");
    expect(gate).not.toContain("github.event.inputs");
    expect(releaseJob).toContain("if ($tag -notmatch '^V\\d+\\.\\d+\\.\\d+$') { throw");
    expect(releaseJob.indexOf("if ($tag -notmatch")).toBeLessThan(releaseJob.indexOf("Setup Node.js"));
  });

  it.each(["", "V0.2.32", "an-unrelated-ref"])(
    "scans the immutable workflow commit and blocks publication regardless of tag %j",
    (tag) => {
      const values = context("workflow_dispatch", true, tag);
      expect(evaluate(checkoutRef, values)).toBe(values.github.sha);
      expect(evaluate(gate, values)).toBe(false);
      expect(evaluate(concurrency, values)).toBe("refs/heads/main");
    },
  );

  it.each([false, undefined])("preserves normal dispatch/tag behavior for scan-only=%s", (scanOnly) => {
    const manual = context("workflow_dispatch", scanOnly);
    expect(evaluate(checkoutRef, manual)).toBe("V0.2.32");
    expect(evaluate(gate, manual)).toBe(true);
    const tagPush = context("push", scanOnly);
    expect(evaluate(checkoutRef, tagPush)).toBe("refs/tags/V0.2.32");
    expect(evaluate(gate, tagPush)).toBe(true);
    expect(evaluate(concurrency, manual)).toBe(evaluate(concurrency, tagPush));
  });

  it("keeps maintenance outside the publication concurrency group even for a tag ref", () => {
    const scan = context("workflow_dispatch", true);
    scan.github.ref = "refs/tags/V0.2.32";
    scan.github.ref_name = "V0.2.32";
    expect(evaluate(concurrency, scan)).not.toBe(evaluate(concurrency, context("push")));
    expect(release).toContain("cancel-in-progress: false");
  });

  it("gates the complete release job rather than selected publish steps", () => {
    // A new job/matrix requires review so always() dependencies cannot bypass maintenance isolation.
    expect([...jobs.matchAll(/^ {2}([\w-]+):$/gm)].map((match) => match[1])).toEqual([
      "dependency-security", "release",
    ]);
    expect(release).not.toContain("strategy:");
    expect(releaseJob).toContain("needs: dependency-security");
    expect(releaseJob).toContain("if: always()");
    expect(releaseJob).toContain("if: failure() && steps.draft-release.outputs.id != ''");
    for (const step of [
      "Build formal Hook release", "Build reviewed UIAccess signing candidate",
      "Attest release build provenance", "Attest release SBOM", "Create verified draft release",
      "Verify assets and publish draft release", "Remove failed draft release",
    ]) expect(releaseJob).toContain(`name: ${step}`);
    for (const dependencyResult of ["success", "failure", "cancelled", "skipped"]) {
      // No status override in the gate: Actions also requires successful needs by default.
      expect(dependencyResult === "success" && evaluate(gate, context("workflow_dispatch", true))).toBe(false);
    }
  });

  it("grants publication and OIDC permissions only to the gated release job", () => {
    expect(release).toMatch(/\npermissions:\n {2}contents: read\n\njobs:/);
    expect(scanJob).toContain("actions: read\n      contents: read\n      security-events: write");
    expect(scanJob).not.toContain("contents: write");
    expect(scanJob).not.toContain("id-token:");
    expect(scanJob).not.toContain("attestations:");
    expect(releaseJob).toContain("permissions:\n      contents: write\n      id-token: write\n      attestations: write");
  });

  it("retains the same reusable OSV chain and SARIF identity without a second analysis", () => {
    expect(scanJob).toContain("uses: ./.github/workflows/dependency-security.yml");
    expect(dependency).toContain("\n  osv:\n");
    expect(dependency).toContain("google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@ffa0a5f39214d80778c9b494822d94d0d9668458");
    expect(dependency).toContain("ref: ${{ inputs.checkout-ref || github.ref }}");
    expect(dependency).toContain("upload-sarif: true");
    expect(dependency).toContain("fail-on-vuln: true");
    expect(release + dependency).not.toMatch(/category:|matrix-property:|upload-sarif@/);
    expect(release + dependency).not.toContain("workflow_run:");
  });

  it("has no completion-triggered publishing or signing workflow", () => {
    for (const name of readdirSync(workflowRoot).filter((name) => name.endsWith(".yml"))) {
      expect(readWorkflow(name), name).not.toContain("workflow_run:");
    }
    const signing = readWorkflow("signpath-signing.yml");
    expect(signing).toContain("workflow_dispatch:");
    expect(signing).not.toMatch(/\n {2}(?:push|release|workflow_call|repository_dispatch):/);
  });
});
