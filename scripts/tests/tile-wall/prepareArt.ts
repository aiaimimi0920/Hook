import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ArtRecord, ArtSources } from './artProbe.ts';
import { openProbe, until, writeJson } from './probeSession.ts';

interface Device { id: string; approval: string; isLocal: boolean }
interface Devices { devices: Device[]; pending: Device[] }
const root = path.resolve(process.argv[2]), packages = path.resolve(process.argv[3]);
const { runtime, request } = await openProbe(root);
const pending = await until(() => request<Devices>('GET', '/v1/devices'),
    (value) => [...value.devices, ...value.pending].some((device) => device.approval === 'pending' && !device.isLocal), 'terminal pairing');
const candidates = [...new Map([...pending.devices, ...pending.pending]
    .filter((device) => device.approval === 'pending' && !device.isLocal).map((device) => [device.id, device])).values()];
assert.equal(candidates.length, 1, 'private registry must have exactly one terminal pairing request');
runtime.deviceId = candidates[0].id;
await request('POST', `/v1/devices/${encodeURIComponent(runtime.deviceId)}/approve`, {});
await request('POST', '/v1/frameworks/process/install', {});
const sources: Partial<ArtSources> = {};
for (const [name, artId] of [['form', 'surface-project-form'], ['dashboard', 'surface-device-dashboard']] as const) {
    const zip = await readFile(path.join(packages, `surface-prototype-${name}.zip`));
    await request('POST', '/v1/arts/install', { zipBase64: zip.toString('base64') });
    const attached = await request<{ instance: ArtRecord }>('POST', '/v1/surfaces/attach', {
        artId, hookNodeId: `hook-node:wall-art-${name}`, deviceId: 'device-000-local',
        capabilities: {
            apiVersion: '1.0', runtimes: ['declarative'],
            nodes: ['view', 'row', 'column', 'stack', 'scroll', 'text', 'image', 'icon', 'button', 'input', 'textarea',
                'number', 'slider', 'switch', 'select', 'progress', 'divider', 'spacer'],
            transports: ['loom_resource'], capabilities: ['remote_resources'],
            input: { pointer: true, hover: true, keyboard: true, touch: false },
        },
    });
    const instanceId = attached.instance.descriptor.instanceId;
    const attachmentIds = Object.keys(attached.instance.attachments);
    assert.equal(attachmentIds.length, 1, 'prototype starts with one ordinary source');
    const attachmentId = attachmentIds[0];
    if (!attached.instance.attachments[attachmentId].snapshot) {
        await request('POST', `/v1/surfaces/instances/${instanceId}/mount`, { attachmentId });
    }
    await request('POST', `/v1/surfaces/instances/${instanceId}/generation`, {});
    sources[name] = { instanceId, attachmentId };
}
await writeJson(path.join(root, 'art-sources.json'), sources);
await writeJson(path.join(root, 'runtime.json'), runtime);
console.log(JSON.stringify({ terminalDeviceId: runtime.deviceId, sourcesPrepared: Object.keys(sources) }));
