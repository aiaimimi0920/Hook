// Fixtures follow the pinned reporter's documented package message and SHA-256 fingerprint.
const { createHash } = require('node:crypto');
const id = 'GHSA-aaaa-bbbb-cccc';
function finding(uri, name = 'fixture', version = '1', ruleId = id) {
  const label = `${name}@${version}`;
  return { ruleId, message: { text: `Package '${label}' is vulnerable to '${ruleId}'.` },
    locations: [{ physicalLocation: { artifactLocation: { uri } } }],
    partialFingerprints: { primaryLocationLineHash: createHash('sha256').update(`${ruleId}:${uri}:${label}`).digest('hex') } };
}
function sarif(results, ids = [id]) {
  return { version: '2.1.0', runs: [{ tool: { driver: { name: 'osv-scanner', rules: [{ id: ids[0], deprecatedIds: ids }] } }, results }] };
}
function pkg(name = 'fixture', version = '1', ids = [id]) {
  return { package: { name, version, ecosystem: 'npm' }, groups: [{ ids, aliases: ids }], vulnerabilities: ids.map(id => ({ id, aliases: ids.filter(alias => alias !== id) })) };
}
module.exports = { id, finding, sarif, pkg };
