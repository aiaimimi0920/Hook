const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { finding, sarif, pkg } = require('./security-osv-fixtures.cjs');
const { runScan } = require('../../.github/scripts/run-osv-scan.cjs');
test('scanner/reporter orchestration never turns process, JSON, coverage or SARIF errors into advisory success', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osv-runner-'));
  try {
    fs.mkdirSync(path.join(root, 'security'));
    fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(root, 'security/config.toml'), '');
    fs.writeFileSync(path.join(root, 'security/dependency-security-policy.json'), JSON.stringify({ scanner: { version: '2.5.1', containerImage: `ghcr.io/google/osv-scanner-action@sha256:${'a'.repeat(64)}` }, lockfiles: ['package-lock.json'], config: 'security/config.toml', advisoryConfig: 'security/config.toml' }));
    const report = { results: [{ source: { type: 'lockfile', path: 'package-lock.json' }, packages: [pkg()] }] };
    for (const failure of ['none', 'enforce-analysis-zero', 'advisory-analysis-zero', 'startup', 'unknown-exit', 'missing-json', 'bad-json', 'coverage', 'reporter-exit', 'missing-sarif', 'empty-sarif']) {
      let call = 0;
      const execute = (command, args) => {
        assert.equal(command, 'docker'); assert.ok(args.includes('--entrypoint'));
        const result = { status: 0, stdout: '', stderr: '' };
        if (++call === 1) return { ...result, stdout: 'osv-scanner version: 2.5.1', ...(failure === 'startup' ? { error: new Error('missing docker') } : {}) };
        if (call === 2) {
          assert.equal(args.includes('--all-vulns'), failure !== 'enforce-analysis-zero');
          const scanReport = structuredClone(report);
          if (failure.endsWith('analysis-zero')) scanReport.results[0].packages[0].groups[0].experimental_analysis = { fixture: { called: false, unimportant: false } };
          if (failure !== 'missing-json') fs.writeFileSync(path.join(root, '.tmp/dependency-security/osv-results.json'), failure === 'bad-json' ? '{' : JSON.stringify(failure === 'coverage' ? { results: [] } : scanReport));
          return { ...result, status: failure === 'unknown-exit' ? 128 : failure.endsWith('analysis-zero') ? 0 : 1 };
        }
        assert.ok(args.includes('/root/osv-reporter'));
        if (failure !== 'missing-sarif') fs.writeFileSync(path.join(root, '.tmp/dependency-security/osv-results.sarif'), JSON.stringify(sarif(failure === 'empty-sarif' ? [] : [finding('package-lock.json')])));
        return { ...result, status: failure === 'reporter-exit' ? 2 : 0 };
      };
      const run = () => runScan({ root, mode: failure === 'enforce-analysis-zero' ? 'enforce' : 'advisory', env: {}, execute });
      if (failure === 'none') assert.equal(run().exitCode, 1);
      else if (failure === 'enforce-analysis-zero') assert.equal(run().exitCode, 0);
      else assert.throws(run, failure);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
