import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertProbeRoute, hasTauriOrigin, loopbackHttpOrigin } from './tile-wall/probeOrigins.ts';
import { openProbe } from './tile-wall/probeSession.ts';

for (const value of [
  'http://tauri.localhost/', 'http://tauri.localhost/index.html#tile',
  'http://TAURI.LOCALHOST/path', 'http://tauri.localhost:80/?test=1',
]) {
  test(`accept native origin ${value}`, () => assert.equal(hasTauriOrigin(value), true));
}
for (const value of [
  'http://tauri.localhost.evil/', 'http://tauri.localhost@evil/',
  'http://user@tauri.localhost/', 'http://tauri.localhost:1234/',
  'https://tauri.localhost/', 'file:///tauri.localhost', 'not a URL',
  'http://evil/?next=http://tauri.localhost',
]) {
  test(`reject non-native origin ${value}`, () => assert.equal(hasTauriOrigin(value), false));
}
for (const value of [1, 9222, 65535]) {
  test(`accept loopback port ${value}`, () => {
    const url = new URL(loopbackHttpOrigin(value));
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.protocol, 'http:');
    assert.equal(url.port, String(value));
  });
}
for (const value of [0, -1, 65536, 1.5, NaN, Infinity, '9222', '9222@evil', null, undefined, {}]) {
  test(`reject untyped port ${String(value)}`, () => assert.throws(() => loopbackHttpOrigin(value)));
}
for (const route of ['/v1/walls/state', '/v1/test?key=value', '/']) {
  test(`accept local route ${route}`, () => assert.doesNotThrow(() => assertProbeRoute(route)));
}
for (const route of ['//evil/', '/\\evil', 'http://evil', '@evil', '/\r\nHost: evil', '/ white']) {
  test(`reject escaping route ${JSON.stringify(route)}`, () => assert.throws(() => assertProbeRoute(route)));
}

test('probe requests retain validated loopback authority despite runtime mutation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hook-origin-test-'));
  const previousFetch = globalThis.fetch;
  const calls = [];
  try {
    await mkdir(path.join(root, 'manifest'));
    const baseUrl = 'http://127.0.0.1:23456/';
    await writeFile(path.join(root, 'runtime.json'), JSON.stringify({ daemonBaseUrl: baseUrl }));
    await writeFile(path.join(root, 'manifest/loom.json'), JSON.stringify({
      transport: { baseUrl, authToken: 'SYNTHETIC_LOCAL_TOKEN' },
    }));
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ ok: true }) };
    };
    const probe = await openProbe(root);
    probe.runtime.daemonBaseUrl = 'https://evil.invalid/';
    assert.deepEqual(await probe.request('GET', '/v1/walls/state'), { ok: true });
    assert.equal(calls[0].url, 'http://127.0.0.1:23456/v1/walls/state');
    assert.equal(calls[0].options.redirect, 'error');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer SYNTHETIC_LOCAL_TOKEN');
    await assert.rejects(probe.request('GET', '//evil.invalid'));
    assert.equal(calls.length, 1);
    await probe.request('GET', '/v1/public', undefined, false);
    assert.equal(calls[1].options.headers.Authorization, undefined);
  } finally {
    globalThis.fetch = previousFetch;
    await rm(root, { recursive: true, force: true });
  }
});
