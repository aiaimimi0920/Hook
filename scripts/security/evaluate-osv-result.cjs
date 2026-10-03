const fs = require('node:fs');
const path = require('node:path');
const { readJson, validateScan, verdict, summary } = require('./osv-result-policy.cjs');

function evaluate({ file, exitCode, mode, root = path.resolve(__dirname, '../..') }) {
  const policy = readJson(path.join(root, 'security/dependency-security-policy.json'));
  const result = validateScan(readJson(file), exitCode, policy.lockfiles);
  const code = verdict(result, mode);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    summary(result, mode, process.env.GITHUB_REPOSITORY));
  console.log(`Validated ${result.sources} lockfiles, ${result.packages} packages, ${result.ids.length} vulnerability IDs; mode=${mode}; scanner-exit=${exitCode}.`);
  return code;
}
if (require.main === module) {
  try {
    const [file, code, mode] = process.argv.slice(2);
    if (!/^[01]$/.test(code || '')) throw new Error('Scanner operational failure.');
    process.exitCode = evaluate({ file, exitCode: Number(code), mode });
  } catch { console.error('Invalid or incomplete scanner evidence; scan remains failed.'); process.exitCode = 2; }
}
module.exports = { evaluate };
