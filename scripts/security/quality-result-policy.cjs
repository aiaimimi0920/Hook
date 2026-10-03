const fs = require('node:fs');
const path = require('node:path');
function check(value) { if (!value) throw new Error('Incomplete or operational quality failure.'); }
function validateEslint(report, exit) {
  check([0, 1].includes(exit) && Array.isArray(report) && report.length > 0);
  let count = 0;
  for (const file of report) {
    check(typeof file.filePath === 'string' && Array.isArray(file.messages));
    check(file.fatalErrorCount === 0 && Number.isInteger(file.errorCount) && Number.isInteger(file.warningCount));
    check(file.messages.every(m => m && !m.fatal && typeof m.ruleId === 'string' && [1, 2].includes(m.severity)));
    check(file.errorCount === file.messages.filter(m => m.severity === 2).length);
    check(file.warningCount === file.messages.filter(m => m.severity === 1).length);
    count += file.messages.length;
  }
  check(exit === (count ? 1 : 0));
  return count;
}
function validateLicenses(report, exit) {
  check([0, 1].includes(exit) && report?.schemaVersion === 1 && report.complete === true);
  check(Array.isArray(report.facts) && Array.isArray(report.findings));
  check(report.directNpmCount > 0 && report.rustCount > 0);
  check(report.facts.filter(f => f.source === 'npm-direct').length === report.directNpmCount);
  check(report.facts.filter(f => f.source === 'cargo').length === report.rustCount);
  check(report.facts.some(f => f.source === 'project') && report.facts.some(f => f.source === 'npm-lock'));
  check(report.facts.every(f => typeof f.license === 'string'));
  check(report.findings.every(f => typeof f === 'string' && f.length > 0));
  check(exit === (report.findings.length ? 1 : 0));
  return report.findings.length;
}
function validateLines(report, exit) {
  check([0, 1].includes(exit) && report?.schemaVersion === 1 && report.mode === 'ratchet');
  check(report.summary?.scanned > 0 && Array.isArray(report.files) && Array.isArray(report.violations));
  check(report.files.every(f => typeof f.path === 'string' && Number.isInteger(f.effectiveLines) && f.effectiveLines > 500));
  for (const violation of report.violations) {
    check(report.files.some(f => (f.effectiveLines > 700 && [
      `${f.path}: ${f.effectiveLines} effective lines exceeds strict limit 700`,
      `${f.path}: oversized baseline file changed before reaching 700 lines`,
    ].includes(violation)) || (f.effectiveLines <= 700 && violation === `${f.path}: ${f.effectiveLines} lines requires a current 501-700 exception`)));
  }
  check(exit === (report.violations.length ? 1 : 0));
  return report.violations.length;
}
function formatReport(stdout, stderr, exit, root) {
  check([0, 1].includes(exit) && stderr.trim() === '');
  if (exit === 0) { check(stdout.trim() === ''); return { schemaVersion: 1, complete: true, diffs: [] }; }
  const diffs = [];
  let current;
  for (const line of stdout.replaceAll('\r\n', '\n').split('\n')) {
    const header = /^Diff in (.+):(\d+):$/.exec(line);
    if (header) {
      const file = path.resolve(header[1].replace(/^\\\\\?\\/, ''));
      const relative = path.relative(root, file);
      check(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && file.endsWith('.rs') && fs.statSync(file).isFile());
      current = { file: relative, line: Number(header[2]), lines: [] }; diffs.push(current);
    } else if (line !== '') {
      check(current && /^[ +\-]/.test(line)); current.lines.push(line);
    }
  }
  check(diffs.length > 0 && diffs.every(d => d.line > 0 && d.lines.some(l => /^[+\-]/.test(l))));
  return { schemaVersion: 1, complete: true, diffs };
}
module.exports = { validateEslint, validateLicenses, validateLines, formatReport };
