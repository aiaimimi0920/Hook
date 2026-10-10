const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateInputs, validateRun, validateArtifact } = require("../../.github/scripts/signing-candidate-policy.cjs");

const inputs = { tag: "v1.2.3", runId: "123", digest: "a".repeat(64) };
const context = { repository: "owner/Hook", workflowId: 7, commit: "b".repeat(40), ...inputs };
const run = { id: 123, repository: { full_name: context.repository }, head_repository: { full_name: context.repository },
  workflow_id: 7, path: ".github/workflows/release-hook-tag.yml", status: "completed", conclusion: "success",
  head_sha: context.commit, head_branch: inputs.tag, event: "push" };

test("signing inputs reject executable syntax and newline suffixes", () => {
  validateInputs(inputs);
  for (const key of Object.keys(inputs)) {
    for (const value of ["$(whoami)", "`whoami", "; whoami", "\"", "'", `${inputs[key]}\n`, `${inputs[key]}\r\n`]) {
      assert.throws(() => validateInputs({ ...inputs, [key]: value }));
    }
  }
});
test("only successful tag runs of the designated workflow are accepted", () => {
  validateRun(run, context);
  validateRun({ ...run, event: "workflow_dispatch" }, context);
  for (const [key, value] of Object.entries({ id: 124, workflow_id: 8, path: ".github/workflows/other.yml",
    status: "in_progress", conclusion: "failure", head_sha: "c".repeat(40), head_branch: "main", event: "pull_request",
    repository: { full_name: "attacker/Hook" }, head_repository: { full_name: "attacker/Hook" } })) {
    assert.throws(() => validateRun({ ...run, [key]: value }, context), key);
  }
});
test("artifact identity and server metadata must match the authenticated run", () => {
  const artifact = { id: 456, name: `hook-uiaccess-signing-candidate-${inputs.tag}`, expired: false,
    size_in_bytes: 1024, digest: `sha256:${inputs.digest}`, workflow_run: { id: 123, head_sha: context.commit } };
  assert.equal(validateArtifact([artifact], context).id, 456);
  for (const patch of [{ expired: true }, { digest: null }, { size_in_bytes: 0 }, { size_in_bytes: 600 * 1024 * 1024 },
    { workflow_run: { id: 456, head_sha: context.commit } }, { workflow_run: { id: 123, head_sha: "wrong" } }]) {
    assert.throws(() => validateArtifact([{ ...artifact, ...patch }], context));
  }
  assert.throws(() => validateArtifact([], context));
  assert.throws(() => validateArtifact([artifact, artifact], context));
});
