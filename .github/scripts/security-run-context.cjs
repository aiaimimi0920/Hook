// Release intent is explicit; PR/main scans never inherit publication defaults.
const fs = require('node:fs');

function classifyReleaseScan({ eventName, ref, sha, scanOnly, tag }) {
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Invalid scan commit.');
  const maintenance = { publish: 'false', mode: 'advisory', ref: sha };
  if (eventName === 'pull_request' || (eventName === 'push' && ref === 'refs/heads/main')) return maintenance;
  if (eventName === 'workflow_dispatch' && scanOnly === true) return maintenance;
  let releaseTag;
  if (eventName === 'push' && typeof ref === 'string' && ref.startsWith('refs/tags/')) {
    releaseTag = ref.slice('refs/tags/'.length);
  } else if (eventName === 'workflow_dispatch' && scanOnly === false) {
    releaseTag = tag;
  }
  if (typeof releaseTag !== 'string' || !/^[vV]\d+\.\d+\.\d+$/.test(releaseTag)) {
    throw new Error('Publication requires an explicit release event and a three-part version tag.');
  }
  return { publish: 'true', mode: 'enforce', ref: releaseTag };
}

if (require.main === module) {
  try {
    const result = classifyReleaseScan({
      eventName: process.env.GITHUB_EVENT_NAME,
      ref: process.env.GITHUB_REF,
      sha: process.env.GITHUB_SHA,
      scanOnly: JSON.parse(process.env.SCAN_ONLY_JSON || 'null'),
      tag: process.env.REQUESTED_TAG,
    });
    fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join(''));
  } catch {
    console.error('Invalid release/scan context; publication remains disabled.');
    process.exitCode = 1;
  }
}
module.exports = { classifyReleaseScan };
