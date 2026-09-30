import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

interface ProcessRow {
    pid: number; startedUtc: string; name: string; path: string;
    privateBytes: number; handles: number; cpuMs: number;
}
type Mutate = (rows: ProcessRow[], seconds: number) => ProcessRow[];
const executable = (name: string) => path.join(os.tmpdir(), 'tile-soak-fixture', name);
const origin = Date.parse('2026-09-12T00:00:00Z');

// Exercise the CLI with recorded-shape observations, without launching product processes.
async function verify(mutate: Mutate = (rows) => rows) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tile-soak-gate-'));
    try {
        const samples = Array.from({ length: 131 }, (_, seconds) => {
            const processes = ['loom-daemon', 'hook', 'hook_lib-abcd', 'msedgewebview2', 'msedgewebview2', 'msedgewebview2']
                .map((name, index) => ({ pid: index + 1, name, path: executable(`${name}.exe`),
                    startedUtc: new Date(origin - 1000).toISOString(), privateBytes: 32 * 1024 * 1024,
                    handles: 80, cpuMs: seconds * 10 }));
            return { atUtc: new Date(origin + seconds * 1000).toISOString(), processes: mutate(processes, seconds) };
        });
        const write = (name: string, value: unknown) => writeFile(path.join(root, name), JSON.stringify(value), 'utf8');
        await write('resource-samples.json', { logicalProcessors: 8, samples });
        await write('runtime.json', { daemonPid: 1, daemonExe: executable('loom-daemon.exe'),
            outputPid: 2, hookExe: executable('hook.exe') });
        await write('input-source-ready.json', { pid: 3, executable: executable('hook_lib-abcd.exe') });
        const result = spawnSync(process.execPath, ['--experimental-strip-types',
            fileURLToPath(new URL('./verifySoakResources.ts', import.meta.url)), root], { encoding: 'utf8', timeout: 10000 });
        assert.equal(result.error, undefined); assert.equal(result.signal, null);
        const report = await readFile(path.join(root, 'resource-result.json'), 'utf8')
            .then((value) => JSON.parse(value) as { passed: boolean; violations: string[] }, () => undefined);
        return { status: result.status, report };
    } finally { await rm(root, { recursive: true, force: true }); }
}

test('accepts stable native-source, daemon and output resource observations', async () => {
    const result = await verify();
    assert.equal(result.status, 0); assert.equal(result.report?.passed, true);
});

test('WebView observations cannot substitute for any required product root', async () => {
    for (const pid of [1, 2, 3]) {
        const result = await verify((rows) => rows.filter((row) => row.pid !== pid));
        assert.notEqual(result.status, 0, `missing product PID ${pid} must fail`);
    }
});

test('wrong executable and reused source PID cannot satisfy root coverage', async () => {
    const wrongPath = await verify((rows) => rows.map((row) => row.pid === 2
        ? { ...row, path: executable('unrelated-hook.exe') } : row));
    assert.notEqual(wrongPath.status, 0);
    const reused = await verify((rows, seconds) => rows.map((row) => row.pid === 3 && seconds >= 100
        ? { ...row, startedUtc: new Date(origin + 100000).toISOString() } : row));
    assert.notEqual(reused.status, 0);
});

test('sustained private memory and handle growth fail the recorded resource gate', async () => {
    for (const field of ['privateBytes', 'handles'] as const) {
        const result = await verify((rows, seconds) => rows.map((row) => row.pid === 3 && seconds >= 100
            ? { ...row, [field]: field === 'handles' ? 200 : 160 * 1024 * 1024 } : row));
        assert.notEqual(result.status, 0); assert.equal(result.report?.passed, false);
        assert(result.report.violations.length > 0);
    }
});
