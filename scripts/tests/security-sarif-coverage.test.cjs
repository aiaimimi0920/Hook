const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateScan, validateSarif } = require('../security/osv-result-policy.cjs');
const { id, finding, sarif, pkg } = require('./security-osv-fixtures.cjs');
const locks = ['package-lock.json', 'src-tauri/Cargo.lock'];
const alias = 'CVE-2026-12345';
function input() {
  return { results: locks.map(lock => ({ source: { path: `/github/workspace/${lock}`, type: 'lockfile' }, packages: [pkg('fixture', '1', [id, alias]), pkg('other', '2', [id, alias])] })) };
}
function complete() { return sarif(locks.flatMap(lock => [finding(lock), finding(lock, 'other', '2')]), [id, alias]); }
test('real alias aggregation keeps one result per package/source, rather than one result per alias', () => {
  const scan = validateScan(input(), 1, locks);
  assert.equal(scan.occurrences.length, 8);
  assert.equal(validateSarif(complete(), scan), 4);
  const duplicate = input(); duplicate.results[0].packages.push(duplicate.results[0].packages[0]);
  assert.equal(validateSarif(complete(), validateScan(duplicate, 1, locks)), 4);
});
test('truncation, wrong packages/versions/locations, missing physical locations and stale fingerprints fail', () => {
  const scan = validateScan(input(), 1, locks);
  for (const mutate of [
    r => r.runs[0].results.pop(),
    r => r.runs[0].results[0] = finding(locks[0], 'wrong', '1'),
    r => r.runs[0].results[0] = finding(locks[0], 'fixture', '99'),
    r => r.runs[0].results[0] = finding('other/package-lock.json'),
    r => r.runs[0].results[0] = finding('../package-lock.json'),
    r => delete r.runs[0].results[0].locations,
    r => delete r.runs[0].results[0].partialFingerprints,
    r => r.runs[0].results[0].message.text = "Package 'other@2' is vulnerable to 'GHSA-aaaa-bbbb-cccc'.",
    r => r.runs[0].tool.driver.rules[0].deprecatedIds = [id],
  ]) { const report = complete(); mutate(report); assert.throws(() => validateSarif(report, scan)); }
});
test('distinct alias groups cannot be combined to conceal a missing finding', () => {
  const r = input(); r.results[0].packages.push(pkg('fixture', '1', ['GHSA-dddd-eeee-ffff']));
  const report = complete(); report.runs[0].tool.driver.rules[0].deprecatedIds.push('GHSA-dddd-eeee-ffff');
  assert.throws(() => validateSarif(report, validateScan(r, 1, locks)));
});
test('indexed artifacts and encoded file URIs preserve real location identity', () => {
  const r = input(); r.results[0].source.path = '/tmp/repo space/package-lock.json';
  const report = complete(); report.runs[0].results[0] = finding('file:///tmp/repo%20space/package-lock.json');
  report.runs[0].artifacts = [{ location: { uri: 'file:///tmp/repo%20space/package-lock.json' } }];
  report.runs[0].results[0].locations[0].physicalLocation.artifactLocation = { index: 0 };
  assert.equal(validateSarif(report, validateScan(r, 1, locks)), 4);
});

test('two versions of the same package in one lock require separate coverage', () => {
  const r = { results: [{ source: { path: locks[0], type: 'lockfile' }, packages: [pkg('fixture', '1'), pkg('fixture', '2')] }] };
  const scan = validateScan(r, 1, [locks[0]]);
  assert.throws(() => validateSarif(sarif([finding(locks[0])]), scan));
  assert.equal(validateSarif(sarif([finding(locks[0]), finding(locks[0], 'fixture', '2')]), scan), 2);
  delete r.results[0].packages[1].vulnerabilities;
  assert.throws(() => validateScan(r, 1, [locks[0]]));
});
