const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readJson } = require('../../scripts/security/osv-result-policy.cjs');
const { validateEslint, validateLicenses, validateLines, formatReport } = require('../../scripts/security/quality-result-policy.cjs');
function runQuality(tool, { root = process.cwd(), execute = spawnSync, env = process.env } = {}) {
  const directory = path.join(root, 'artifacts/quality', tool || 'invalid');
  const reportPath = path.join(directory, 'results.json');
  const commands = {
    eslint: [process.execPath, ['node_modules/eslint/bin/eslint.js', 'src', '--max-warnings', '0', '--format', 'json', '--output-file', reportPath]],
    licenses: ['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/audit-open-source-dependencies.ps1', '-ReportPath', `artifacts/quality/licenses/results.json`]],
    lines: [process.execPath, ['scripts/effective-code-lines.mjs', '--mode', 'ratchet', '--json', reportPath]],
    format: ['cargo', ['fmt', '--check', '--manifest-path', 'src-tauri/Cargo.toml', '--', '--color', 'never']],
  };
  if (!Object.hasOwn(commands, tool)) throw new Error('Unknown quality tool.');
  fs.mkdirSync(directory, { recursive: true });
  for (const file of ['results.json', 'process.json', 'format.diff']) fs.rmSync(path.join(directory, file), { force: true });
  const [command, args] = commands[tool];
  const result = execute(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  // Retain tool evidence even when validation fails; never reuse an earlier report.
  fs.writeFileSync(path.join(directory, 'process.json'), JSON.stringify({ exit: result.status, signal: result.signal, startupError: Boolean(result.error), stdout: result.stdout, stderr: result.stderr }, null, 2));
  if (result.error || result.signal) throw new Error('Quality tool could not complete.');
  let count;
  if (tool === 'format') {
    fs.writeFileSync(path.join(directory, 'format.diff'), result.stdout);
    const report = formatReport(result.stdout, result.stderr, result.status, root);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); count = report.diffs.length;
  } else {
    const validate = { eslint: validateEslint, licenses: validateLicenses, lines: validateLines }[tool];
    count = validate(readJson(reportPath), result.status);
  }
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY,
    `## ${tool}: development advisory\n\nValidated ${count} findings (tool exit ${result.status}). Full evidence is in the quality-${tool} artifact. Tool/report/upload errors still fail; release gates remain strict.\n`);
  return count;
}
if (require.main === module) {
  try { const count = runQuality(process.argv[2]); console.log(`Validated quality report: ${count} advisory findings.`); }
  catch { console.error('Quality tool/report failure; no advisory success was granted.'); process.exitCode = 2; }
}
module.exports = { runQuality };
