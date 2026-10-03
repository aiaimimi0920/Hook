// Keep scanner failures distinct from vulnerability exit 1. Never print raw tool errors.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readJson, validateScan, validateSarif, summary } = require('../../scripts/security/osv-result-policy.cjs');

function runScan({ root = process.cwd(), mode = process.env.SECURITY_MODE, env = process.env, execute = spawnSync } = {}) {
  if (!['advisory', 'enforce'].includes(mode)) throw new Error('Invalid scan mode.');
  const policy = readJson(path.join(root, 'security/dependency-security-policy.json'));
  const image = policy.scanner.containerImage;
  if (!/^ghcr\.io\/google\/osv-scanner-action@sha256:[a-f0-9]{64}$/.test(image || '')) throw new Error('Scanner image must be digest-pinned.');
  const output = path.join(root, '.tmp/dependency-security');
  fs.mkdirSync(output, { recursive: true });
  const json = '.tmp/dependency-security/osv-results.json';
  const sarif = '.tmp/dependency-security/osv-results.sarif';
  for (const file of [json, sarif]) fs.rmSync(path.join(root, file), { force: true });
  const config = mode === 'advisory' ? policy.advisoryConfig : policy.config;
  for (const file of [...policy.lockfiles, config]) {
    if (typeof file !== 'string' || path.isAbsolute(file) || file.split(/[\\/]/).includes('..') || !fs.statSync(path.join(root, file)).isFile()) {
      throw new Error('Invalid scan input path.');
    }
  }
  const docker = (entrypoint, args) => execute('docker', [
    'run', '--rm', '--volume', `${root}:/github/workspace`, '--workdir', '/github/workspace',
    '--env', 'GOTOOLCHAIN=auto', '--entrypoint', entrypoint, image, ...args,
  ], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  // Bypass the upstream action shell wrapper, which can normalize exit 128.
  const version = docker('osv-scanner', ['--version']);
  if (version.error || version.signal || version.status !== 0 || !`${version.stdout}\n${version.stderr}`.includes(`osv-scanner version: ${policy.scanner.version}`)) {
    throw new Error('Scanner startup/version validation failed.');
  }
  console.log('OSV scanner startup/version validated.');
  const scan = docker('osv-scanner', ['scan', '--format=json', '--all-packages', ...(mode === 'advisory' ? ['--all-vulns'] : []),
    `--output-file=${json}`, `--config=${config}`, ...policy.lockfiles.map((file) => `--lockfile=${file}`)]);
  if (scan.error || scan.signal) throw new Error('Scanner process failed.');
  console.log(`OSV scanner completed with exit ${scan.status}.`);
  const result = validateScan(readJson(path.join(root, json)), scan.status, policy.lockfiles, { allVulns: mode === 'advisory' });
  console.log('OSV JSON inventory validated.');
  const report = docker('/root/osv-reporter', [
    `--new=${json}`, `--output-files=sarif:${sarif}`, '--all-vulns', '--fail-on-vuln=false',
  ]);
  if (report.error || report.signal || report.status !== 0) throw new Error('Reporter process failed.');
  console.log('OSV reporter completed.');
  validateSarif(readJson(path.join(root, sarif)), result);
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, summary(result, mode, env.GITHUB_REPOSITORY));
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `scanner-exit=${scan.status}\nmode=${mode}\n`);
  return result;
}
if (require.main === module) {
  try { runScan(); console.log('OSV JSON and SARIF validated; publication policy is evaluated after uploads.'); }
  catch { console.error('OSV scanner, result validation, or report generation failed. Findings were not converted into success.'); process.exitCode = 2; }
}
module.exports = { runScan };
