const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateEslint, validateLicenses, validateLines, formatReport } = require('../security/quality-result-policy.cjs');
const { runQuality } = require('../../.github/scripts/run-quality-advisory.cjs');
test('ESLint findings are advisory while parse/config/unknown and incomplete reports fail', () => {
  const r = [{ filePath: 'a.ts', fatalErrorCount: 0, errorCount: 1, warningCount: 0, messages: [{ ruleId: 'no-unused-vars', severity: 2 }] }];
  assert.equal(validateEslint(r, 1), 1);
  for (const code of [0, 2, null]) assert.throws(() => validateEslint(r, code));
  r[0].messages[0].fatal = true; assert.throws(() => validateEslint(r, 1));
  assert.throws(() => validateEslint([], 0));
});
test('license findings need complete inventories; missing manifests/metadata never become success', () => {
  const r = { schemaVersion: 1, complete: true, directNpmCount: 1, rustCount: 1, findings: ['missing license'], facts: ['project', 'npm-direct', 'npm-lock', 'cargo'].map(source => ({ source, license: '' })) };
  assert.equal(validateLicenses(r, 1), 1); assert.throws(() => validateLicenses(r, 2));
  r.facts.pop(); assert.throws(() => validateLicenses(r, 1));
});
test('line ratchet findings are recognized; filesystem/UTF8 diagnostics remain errors', () => {
  const r = { schemaVersion: 1, mode: 'ratchet', summary: { scanned: 1 }, files: [{ path: 'a.ts', effectiveLines: 800 }], violations: ['a.ts: oversized baseline file changed before reaching 700 lines'] };
  assert.equal(validateLines(r, 1), 1);
  for (const message of ['a.ts: symbolic links and junctions are not scanned', 'unknown failure', 'b.ts: oversized baseline file changed before reaching 700 lines']) { r.violations = [message]; assert.throws(() => validateLines(r, 1)); }
});
test('stable rustfmt diff parser requires existing in-repo Rust paths, complete diff and no error text', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-format-'));
  try {
    const file = path.join(root, 'fixture.rs'); fs.writeFileSync(file, 'fn main(){}');
    const diff = `Diff in ${file}:1:\n-fn main(){}\n+fn main() {}\n`;
    assert.equal(formatReport(diff, '', 1, root).diffs.length, 1);
    for (const [out, err, code] of [[diff, 'parse error', 1], [diff, '', 2], ['parse error', '', 1], [`Diff in ${file}:1:\n`, '', 1], [diff, '', 0]]) assert.throws(() => formatReport(out, err, code, root));
    assert.deepEqual(formatReport('', '', 0, root).diffs, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('runner rejects missing, malformed, stale reports, spawn failure and unknown exits', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-runner-'));
  try {
    for (const tool of ['eslint', 'lines']) for (const result of [{ status: 1 }, { status: 2 }, { status: null, error: new Error('spawn') }]) {
      const dir = path.join(root, 'artifacts/quality', tool); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'results.json'), '[]');
      assert.throws(() => runQuality(tool, { root, env: {}, execute: () => ({ stdout: '', stderr: '', ...result }) }));
      assert.ok(!fs.existsSync(path.join(dir, 'results.json')));
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('quality checkout retains history required by the fixed line-checker baseline', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../../.github/workflows/code-quality-advisory.yml'), 'utf8');
  assert.match(workflow, /fetch-depth: 0/);
  assert.ok(!workflow.includes('continue-on-error:'));
  assert.match(workflow, /if-no-files-found: error/);
});
