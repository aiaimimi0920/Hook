// OSV 2.5.1 internal/output/{result,sarif}.go aggregates aliases, not package locations.
const { createHash } = require('node:crypto');
function check(value) { if (!value) throw new Error('Incomplete or inconsistent OSV finding coverage.'); }
const strings = value => Array.isArray(value) && value.every(v => typeof v === 'string' && v.length > 0);
function packageFindings(entry, source, relative) {
  const vulns = entry.vulnerabilities || [];
  if (!vulns.length) { check(entry.groups === undefined || (Array.isArray(entry.groups) && entry.groups.length === 0)); return []; }
  check(new Set(vulns.map(v => v.id)).size === vulns.length);
  check(Array.isArray(entry.groups) && entry.groups.length > 0);
  const pkg = entry.package;
  check(pkg.commit === undefined || typeof pkg.commit === 'string');
  const label = `${pkg.name}@${pkg.commit ? pkg.commit.slice(0, 8) : pkg.version}`;
  return vulns.map(v => {
    const groups = entry.groups.filter(g => strings(g.ids) && g.ids.includes(v.id));
    check(groups.length === 1 && (v.aliases === undefined || strings(v.aliases)));
    const group = groups[0];
    check(strings(group.aliases) && group.ids.every(id => vulns.some(item => item.id === id)));
    const analysis = group.experimental_analysis;
    check(analysis === undefined || (analysis && typeof analysis === 'object' && !Array.isArray(analysis)));
    const values = Object.values(analysis || {});
    check(values.every(a => a && typeof a.called === 'boolean' && typeof a.unimportant === 'boolean'));
    const called = !values.length || values.some(a => a.called);
    const unimportant = values.some(a => a.unimportant);
    return { id: v.id, aliases: [...new Set([v.id, ...group.ids, ...(v.aliases || [])])],
      source, relative, label, actionable: called && !unimportant };
  });
}
function aliasGroups(occurrences) {
  const groups = [];
  for (const item of occurrences) {
    const merged = new Set(item.aliases);
    for (let i = groups.length - 1; i >= 0; i--) {
      if ([...groups[i]].some(id => merged.has(id))) {
        for (const id of groups.splice(i, 1)[0]) merged.add(id);
      }
    }
    groups.push(merged);
  }
  return groups;
}
function artifactUri(run, finding) {
  check(Array.isArray(finding.locations) && finding.locations.length === 1);
  let artifact = finding.locations[0]?.physicalLocation?.artifactLocation;
  check(artifact && artifact.uriBaseId === undefined);
  if (artifact.uri === undefined) {
    check(Number.isInteger(artifact.index) && artifact.index >= 0);
    artifact = run.artifacts?.[artifact.index]?.location;
    check(artifact && artifact.uriBaseId === undefined);
  }
  check(typeof artifact.uri === 'string' && artifact.uri.length > 0);
  return artifact.uri;
}
function sourceMatches(uri, item) {
  let normalized;
  if (uri.startsWith('file:')) {
    const parsed = new URL(uri);
    check(!parsed.hostname && !parsed.search && !parsed.hash);
    normalized = decodeURIComponent(parsed.pathname).replace(/^\/([A-Za-z]:\/)/, '$1');
  } else {
    check(!/[?#\\]/.test(uri) && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(uri));
    normalized = decodeURIComponent(uri);
  }
  check(!normalized.split('/').some(segment => segment === '..' || segment === '.'));
  return normalized === item.relative || normalized === item.source || normalized === `/github/workspace/${item.relative}`;
}
function validateSarif(report, scan) {
  check(report?.version === '2.1.0' && Array.isArray(report.runs) && report.runs.length > 0);
  const occurrences = scan.occurrences;
  check(Array.isArray(occurrences));
  const groups = aliasGroups(occurrences);
  const covered = new Set();
  let count = 0;
  for (const run of report.runs) {
    const driver = run?.tool?.driver;
    check(typeof driver?.name === 'string' && driver.name.length > 0);
    check(run.results === undefined || Array.isArray(run.results));
    check(driver.rules === undefined || Array.isArray(driver.rules));
    const rules = new Map();
    for (const rule of driver.rules || []) {
      check(typeof rule?.id === 'string' && !rules.has(rule.id));
      check(rule.deprecatedIds === undefined || strings(rule.deprecatedIds));
      const aliases = new Set([rule.id, ...(rule.deprecatedIds || [])]);
      const expected = groups.find(group => group.has(rule.id));
      check(expected && aliases.size === expected.size && [...expected].every(id => aliases.has(id)));
      rules.set(rule.id, aliases);
    }
    for (const finding of run.results || []) {
      const aliases = rules.get(finding?.ruleId);
      check(aliases && typeof finding?.message?.text === 'string');
      const uri = artifactUri(run, finding);
      let matched = false;
      occurrences.forEach((item, index) => {
        if (!aliases.has(item.id) || !sourceMatches(uri, item)) return;
        const prefix = `Package '${item.label}' is vulnerable to '${finding.ruleId}'`;
        if (!finding.message.text.startsWith(prefix) || !finding.message.text.endsWith('.')) return;
        const hash = createHash('sha256').update(`${finding.ruleId}:${uri}:${item.label}`).digest('hex');
        if (finding.partialFingerprints?.primaryLocationLineHash !== hash) return;
        covered.add(index); matched = true;
      });
      check(matched); count++;
    }
  }
  check(covered.size === occurrences.length);
  return count;
}
module.exports = { packageFindings, validateSarif };
