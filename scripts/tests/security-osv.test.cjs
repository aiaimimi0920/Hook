const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateScan, validateSarif, verdict, summary } = require('../security/osv-result-policy.cjs');
const { classifyReleaseScan } = require('../../.github/scripts/security-run-context.cjs');
const locks = ['package-lock.json', 'src-tauri/Cargo.lock'];
const evidence = (vulnerable = false) => ({ results: locks.map(lock => ({ source: { type: 'lockfile', path: `/github/workspace/${lock}` }, packages: [{ package: { name: 'fixture', version: '1', ecosystem: 'npm' }, ...(vulnerable ? { vulnerabilities: [{ id: 'GHSA-aaaa-bbbb-cccc' }] } : {}) }] })) });
test('complete clean and finding reports preserve original scanner exit and release enforcement', () => {
  for (const exit of [0, 1]) { const scan = validateScan(evidence(Boolean(exit)), exit, locks); assert.equal(verdict(scan, 'advisory'), 0); assert.equal(verdict(scan, 'enforce'), exit); }
});
test('unknown exits, empty findings exit, missing/duplicate sources and bad package data fail closed', () => {
  for (const exit of [2, 128, null, undefined]) assert.throws(() => validateScan(evidence(true), exit, locks));
  assert.throws(() => validateScan(evidence(), 1, locks));
  for (const mutate of [r => r.results.pop(), r => r.results.push(r.results[0]), r => r.results[0].packages = [], r => delete r.results[0].packages[0].package.version, r => r.results[0].packages[0].vulnerabilities = {}]) { const r = evidence(true); mutate(r); assert.throws(() => validateScan(r, 1, locks)); }
});
test('SARIF must be parseable and retain findings; summary excludes arbitrary package text', () => {
  const scan = validateScan(evidence(true), 1, locks);
  assert.throws(() => validateSarif({}, scan));
  assert.throws(() => validateSarif({ version: '2.1.0', runs: [{ tool: { driver: { name: 'OSV', rules: [{ id: 'GHSA-aaaa-bbbb-cccc' }] } } }] }, scan));
  assert.equal(validateSarif({ version: '2.1.0', runs: [{ tool: { driver: { name: 'OSV', rules: [{ id: 'GHSA-aaaa-bbbb-cccc' }] } }, results: [{ ruleId: 'GHSA-aaaa-bbbb-cccc', message: { text: 'fixture' } }] }] }, scan), 1);
  scan.ids.push('<script>secret</script>'); assert.ok(!summary(scan, 'advisory', 'owner/repo').includes('<script>'));
});
test('only explicit release events and valid tags can publish; PR/main and maintenance cannot', () => {
  const base = { sha: 'a'.repeat(40), tag: 'V1.2.3' };
  for (const input of [{ eventName: 'pull_request' }, { eventName: 'push', ref: 'refs/heads/main' }, { eventName: 'workflow_dispatch', scanOnly: true, tag: 'unrelated' }]) assert.deepEqual(classifyReleaseScan({ ...base, ...input }), { publish: 'false', mode: 'advisory', ref: base.sha });
  for (const input of [{ eventName: 'push', ref: 'refs/tags/V1.2.3' }, { eventName: 'workflow_dispatch', scanOnly: false }]) assert.equal(classifyReleaseScan({ ...base, ...input }).mode, 'enforce');
  for (const scanOnly of [undefined, null, '', 'false', 0]) assert.throws(() => classifyReleaseScan({ ...base, eventName: 'workflow_dispatch', scanOnly }));
  for (const tag of ['', 'main', 'V1.2.3.4', 'V1.2.3\ninjected=true']) assert.throws(() => classifyReleaseScan({ ...base, eventName: 'workflow_dispatch', scanOnly: false, tag }));
  for (const eventName of ['workflow_run', 'schedule', 'repository_dispatch']) assert.throws(() => classifyReleaseScan({ ...base, eventName }));
});
test('real vulnerable fixture validates as advisory but remains strict for release when provided', { skip: !process.env.OSV_FIXTURE }, () => {
  const r = JSON.parse(fs.readFileSync(process.env.OSV_FIXTURE, 'utf8'));
  const scan = validateScan(r, 1, ['package-lock.json']); assert.equal(verdict(scan, 'advisory'), 0); assert.equal(verdict(scan, 'enforce'), 1); assert.ok(scan.ids.length > 0);
});
