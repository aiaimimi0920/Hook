// Validate scanner evidence before distinguishing findings from operational errors.
const fs = require('node:fs');
const { packageFindings, validateSarif } = require('./osv-sarif-coverage.cjs');

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}
function readJson(file) {
  const stat = fs.statSync(file);
  requireCondition(stat.isFile() && stat.size > 0 && stat.size <= 64 * 1024 * 1024, 'Invalid report size.');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function validateScan(result, exitCode, lockfiles, { allVulns = false } = {}) {
  requireCondition(exitCode === 0 || exitCode === 1, 'Scanner operational failure.');
  requireCondition(result && Array.isArray(result.results), 'Missing scanner result array.');
  const expected = new Set(lockfiles);
  const sources = new Set();
  const ids = new Set();
  let packages = 0;
  const occurrences = [];
  for (const source of result.results) {
    requireCondition(source?.source?.type === 'lockfile' && typeof source.source.path === 'string', 'Invalid scanner source.');
    const normalized = source.source.path.replaceAll('\\', '/');
    const relative = lockfiles.find((lock) => normalized === lock || normalized.endsWith(`/${lock}`));
    requireCondition(relative && !sources.has(relative), 'Unexpected or duplicated scanner source.');
    sources.add(relative);
    requireCondition(Array.isArray(source.packages) && source.packages.length > 0, 'Missing package inventory.');
    for (const entry of source.packages) {
      requireCondition(entry?.package && ['name', 'version', 'ecosystem'].every((key) => typeof entry.package[key] === 'string' && entry.package[key].length > 0), 'Invalid package record.');
      packages++;
      if (entry.vulnerabilities !== undefined) requireCondition(Array.isArray(entry.vulnerabilities), 'Invalid vulnerability list.');
      for (const vulnerability of entry.vulnerabilities || []) {
        requireCondition(typeof vulnerability?.id === 'string' && vulnerability.id.length > 0 && vulnerability.id.length <= 200, 'Invalid vulnerability identity.');
        ids.add(vulnerability.id);
      }
      occurrences.push(...packageFindings(entry, normalized, relative));
    }
  }
  requireCondition(sources.size === expected.size && [...expected].every((lock) => sources.has(lock)), 'Incomplete lockfile scan.');
  requireCondition(exitCode !== 1 || ids.size > 0, 'Finding exit code has no findings.');
  // OSV can legitimately return 0 for analysis-only findings without --all-vulns.
  requireCondition(exitCode !== 0 || !occurrences.some(item => allVulns || item.actionable), 'Scanner exit disagrees with finding analysis.');
  return { exitCode, packages, sources: sources.size, ids: [...ids].sort(), occurrences };
}
function verdict(scan, mode) {
  requireCondition(mode === 'advisory' || mode === 'enforce', 'Unknown security mode.');
  return mode === 'enforce' && scan.exitCode === 1 ? 1 : 0;
}
function summary(scan, mode, repository) {
  requireCondition(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), 'Invalid repository identity.');
  const safeIds = scan.ids.filter((id) => /^(?:CVE-\d{4}-\d+|GHSA-[a-z0-9-]+|RUSTSEC-\d{4}-\d+)$/.test(id));
  const examples = safeIds.slice(0,40).map((id) => `- ${id}`).join('\n');
  return `## Dependency security: ${mode}\n\nValidated ${scan.sources} lockfiles and ${scan.packages} packages; ${scan.ids.length} unique vulnerability IDs. Scanner exit: ${scan.exitCode}.\n\n` +
    (mode === 'advisory' ? 'Valid findings are advisory for development. Tool/report/upload errors still fail.\n\n' : 'Release enforcement remains enabled.\n\n') +
    `[Track deduplicated Security alerts](https://github.com/${repository}/security/code-scanning?query=is%3Aopen+tool%3Aosv-scanner). Full JSON and SARIF are retained in the run artifacts; the list below is a bounded preview.\n\n${examples}\n`;
}
module.exports = { readJson, validateScan, validateSarif, verdict, summary };
