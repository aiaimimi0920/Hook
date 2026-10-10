// GitHub API metadata, not claims inside the candidate, establishes its producer.
function validateInputs({ tag, runId, digest }) {
  for (const value of [tag, runId, digest]) {
    if (typeof value !== "string" || /[\r\n]/.test(value)) throw new Error("Invalid signing input");
  }
  if (!/^[vV][0-9]+\.[0-9]+\.[0-9]+$/.test(tag ?? "")) throw new Error("Invalid public tag");
  if (!/^[1-9][0-9]*$/.test(runId ?? "")) throw new Error("Invalid candidate run ID");
  if (!/^[a-fA-F0-9]{64}$/.test(digest ?? "")) throw new Error("Invalid reviewed SHA-256");
}

function validateRun(run, { repository, workflowId, commit, tag, runId }) {
  if (String(run.id) !== runId || run.repository?.full_name !== repository ||
      run.head_repository?.full_name !== repository || run.workflow_id !== workflowId ||
      run.path !== ".github/workflows/release-hook-tag.yml" ||
      run.status !== "completed" || run.conclusion !== "success" ||
      run.head_sha !== commit || run.head_branch !== tag ||
      !["push", "workflow_dispatch"].includes(run.event)) {
    throw new Error("Candidate run is not a successful tagged release producer");
  }
}

function validateArtifact(artifacts, { tag, runId, commit }) {
  const matches = artifacts.filter(a => a.name === `hook-uiaccess-signing-candidate-${tag}`);
  if (matches.length !== 1) throw new Error("Expected exactly one signing candidate artifact");
  const artifact = matches[0];
  if (artifact.expired || !Number.isSafeInteger(artifact.id) || artifact.id <= 0 ||
      !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes <= 0 ||
      artifact.size_in_bytes > 512 * 1024 * 1024 ||
      String(artifact.workflow_run?.id) !== runId || artifact.workflow_run?.head_sha !== commit ||
      !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? "")) {
    throw new Error("Candidate artifact metadata is invalid");
  }
  return artifact;
}

async function verifyCandidate({ github, owner, repo, tag, runId, digest }) {
  validateInputs({ tag, runId, digest });
  const repository = `${owner}/${repo}`;
  const { data: workflow } = await github.rest.actions.getWorkflow({ owner, repo, workflow_id: "release-hook-tag.yml" });
  const { data: source } = await github.rest.repos.getCommit({ owner, repo, ref: `refs/tags/${tag}` });
  const { data: ancestry } = await github.rest.repos.compareCommits({ owner, repo, base: source.sha, head: "main" });
  if (!["ahead", "identical"].includes(ancestry.status)) throw new Error("Tag is not reachable from main");
  const { data: run } = await github.rest.actions.getWorkflowRun({ owner, repo, run_id: runId });
  validateRun(run, { repository, workflowId: workflow.id, commit: source.sha, tag, runId });
  const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, { owner, repo, run_id: runId, per_page: 100 });
  const artifact = validateArtifact(artifacts, { tag, runId, commit: source.sha });
  return { artifactId: artifact.id, commit: source.sha };
}

module.exports = { validateInputs, validateRun, validateArtifact, verifyCandidate };
