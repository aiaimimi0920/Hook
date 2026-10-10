const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readJson } = require('../security/osv-result-policy.cjs');

function fixture(t, content = '{"source":"original"}') {
  const root = path.resolve(__dirname, '../../artifacts');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'report-reading-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'report.json');
  fs.writeFileSync(file, content, 'utf8');
  return { file, directory };
}

// Inject a deterministic change after metadata inspection, not a timing-dependent race.
function afterInspection(t, action) {
  let changed = false;
  for (const name of ['statSync', 'fstatSync']) {
    const original = fs[name];
    t.mock.method(fs, name, (...args) => {
      const stat = original(...args);
      if (!changed) { changed = true; action(); }
      return stat;
    });
  }
}

test('JSON report reading stays bound to the inspected file after a path replacement', (t) => {
  const { file, directory } = fixture(t);
  afterInspection(t, () => {
    fs.renameSync(file, path.join(directory, 'original.json'));
    fs.writeFileSync(file, '{"source":"replacement"}', 'utf8');
  });
  assert.deepEqual(readJson(file), { source: 'original' });
});

for (const change of ['grow', 'shrink']) {
  test(`report ${change} after inspection is rejected instead of consuming unchecked bytes`, (t) => {
    const { file } = fixture(t);
    afterInspection(t, () => change === 'grow' ? fs.appendFileSync(file, ' '.repeat(1024)) : fs.writeFileSync(file, '{}'));
    assert.throws(() => readJson(file), /report (size|changed)/i);
  });
}

test('empty, oversized, non-file and malformed reports fail closed; missing files still fail', (t) => {
  const { file, directory } = fixture(t, '');
  assert.throws(() => readJson(file), /Invalid report size/);
  fs.truncateSync(file, 64 * 1024 * 1024 + 1);
  assert.throws(() => readJson(file), /Invalid report size/);
  assert.throws(() => readJson(directory));
  assert.throws(() => readJson(path.join(directory, 'missing.json')));
  fs.writeFileSync(file, '{broken');
  assert.throws(() => readJson(file), SyntaxError);
});

test('partial reads preserve complete UTF-8 JSON and close the descriptor', (t) => {
  const { file } = fixture(t, '{"name":"安全证据"}');
  const read = fs.readSync;
  const close = fs.closeSync;
  let closed = 0;
  t.mock.method(fs, 'readSync', (fd, buffer, offset, length, position) => read(fd, buffer, offset, Math.min(length, 2), position));
  t.mock.method(fs, 'closeSync', (fd) => { closed++; return close(fd); });
  assert.deepEqual(readJson(file), { name: '安全证据' });
  assert.equal(closed, 1);
});

for (const failure of ['metadata', 'read', 'parse', 'size']) {
  test(`descriptor closes after ${failure} failure`, (t) => {
    const { file } = fixture(t, failure === 'parse' ? '{broken' : failure === 'size' ? '' : '{}');
    const close = fs.closeSync;
    let closed = 0;
    t.mock.method(fs, 'closeSync', (fd) => { closed++; return close(fd); });
    if (failure === 'metadata') t.mock.method(fs, 'fstatSync', () => { throw new Error('metadata failure'); });
    if (failure === 'read') t.mock.method(fs, 'readSync', () => { throw new Error('read failure'); });
    assert.throws(() => readJson(file));
    assert.equal(closed, 1);
  });
}
