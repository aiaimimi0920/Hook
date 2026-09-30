import assert from 'node:assert/strict';
import path from 'node:path';
import { readJson, writeJson, type ProbeRuntime } from './probeSession.ts';

interface ProcessSample { pid: number; startedUtc: string; name: string; path: string; privateBytes: number; handles: number; cpuMs: number }
interface Sample { atUtc: string; processes: ProcessSample[] }
const root = path.resolve(process.argv[2]);
const runtime = await readJson<ProbeRuntime>(path.join(root, 'runtime.json'));
const source = await readJson<{ pid: number; executable: string }>(path.join(root, 'input-source-ready.json'));
const report = await readJson<{ logicalProcessors: number; samples: Sample[] }>(path.join(root, 'resource-samples.json'));
assert(report.logicalProcessors > 0 && report.samples.length >= 60 && report.samples.length <= 720);
const first = Date.parse(report.samples[0].atUtc), last = Date.parse(report.samples.at(-1)!.atUtc);
assert(last - first >= 115000);
const product = (row: ProcessSample) => /^(hook|loom-daemon|hook_lib-[0-9a-f]+|msedgewebview2)$/.test(row.name);
const mean = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;
const key = (row: ProcessSample) => `${row.pid}:${row.startedUtc}`;
const baseline = report.samples.filter((row) => Date.parse(row.atUtc) - first >= 60000 && Date.parse(row.atUtc) - first < 90000);
const tail = report.samples.filter((row) => last - Date.parse(row.atUtc) < 30000);
assert(baseline.length >= 10 && tail.length >= 10, 'resource windows need enough actual observations');
const violations: string[] = [];
const stable = new Map<string, ProcessSample>();
for (const row of baseline.flatMap((sample) => sample.processes).filter(product)) stable.set(key(row), row);
const processes = [];
for (const [identity, row] of stable) {
    const samples = report.samples.flatMap((sample) => sample.processes.filter((value) => key(value) === identity)
        .map((value) => ({ at: Date.parse(sample.atUtc), ...value })));
    const before = baseline.flatMap((sample) => sample.processes.filter((value) => key(value) === identity));
    const after = tail.flatMap((sample) => sample.processes.filter((value) => key(value) === identity));
    if (before.length < 10 || after.length < 10) continue;
    const privateBefore = mean(before.map((value) => value.privateBytes)), privateAfter = mean(after.map((value) => value.privateBytes));
    const handlesBefore = mean(before.map((value) => value.handles)), handlesAfter = mean(after.map((value) => value.handles));
    const privateLimit = Math.max(64 * 1024 * 1024, privateBefore * 0.25);
    if (privateAfter - privateBefore > privateLimit) violations.push(`private growth ${row.name}:${row.pid}`);
    if (handlesAfter - handlesBefore > 64) violations.push(`handle growth ${row.name}:${row.pid}`);
    const begin = samples[0], end = samples.at(-1)!;
    processes.push({ pid: row.pid, name: row.name, path: row.path, startedUtc: row.startedUtc, samples: samples.length,
        privateBefore, privateAfter, privateGrowthBytes: privateAfter - privateBefore, privateGrowthLimitBytes: privateLimit,
        privatePeak: Math.max(...samples.map((value) => value.privateBytes)), handlesBefore, handlesAfter,
        handlesGrowth: handlesAfter - handlesBefore, handlesPeak: Math.max(...samples.map((value) => value.handles)),
        meanMachineCpuPercent: (end.cpuMs - begin.cpuMs) / (end.at - begin.at) * 100 / report.logicalProcessors });
}
const executableKey = (value: string) => path.resolve(value).toLowerCase();
const required = [
    { role: 'daemon', pid: runtime.daemonPid, executable: runtime.daemonExe },
    { role: 'output', pid: runtime.outputPid, executable: runtime.hookExe },
    { role: 'source', pid: source.pid, executable: source.executable },
];
for (const item of required) {
    // A stable identity needs observations in both windows; recycled PIDs do not qualify.
    const matches = processes.filter((row) => row.pid === item.pid && row.path
        && executableKey(row.path) === executableKey(item.executable));
    if (matches.length !== 1) violations.push(`missing stable ${item.role} process or executable mismatch`);
}
const totals = (samples: Sample[], field: 'privateBytes' | 'handles') => samples.map((sample) =>
    sample.processes.filter(product).reduce((total, row) => total + row[field], 0));
const aggregateBefore = mean(totals(baseline, 'privateBytes')), aggregateAfter = mean(totals(tail, 'privateBytes'));
const aggregateLimit = Math.max(128 * 1024 * 1024, aggregateBefore * 0.25);
const handlesBefore = mean(totals(baseline, 'handles')), handlesAfter = mean(totals(tail, 'handles'));
if (aggregateAfter - aggregateBefore > aggregateLimit) violations.push('aggregate private growth');
if (handlesAfter - handlesBefore > 128) violations.push('aggregate handle growth');
await writeJson(path.join(root, 'resource-result.json'), { passed: violations.length === 0, violations, processes, required,
    observationMs: last - first, logicalProcessors: report.logicalProcessors, samples: report.samples.length,
    baselineWindowSeconds: [60, 90], tailWindowSeconds: 30, perProcessHandleGrowthLimit: 64, aggregateHandleGrowthLimit: 128,
    aggregate: { privateBefore: aggregateBefore, privateAfter: aggregateAfter, privateGrowthBytes: aggregateAfter - aggregateBefore,
        privateGrowthLimitBytes: aggregateLimit, handlesBefore, handlesAfter },
    scope: 'owned product processes plus native source harness; test runners and unrelated user processes excluded' });
assert.equal(violations.length, 0, 'bounded resource gate failed; inspect resource-result.json');
