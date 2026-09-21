import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openProbe, readJson, until, writeJson } from './probeSession.ts';

interface Device { id: string; name: string; approval: string; isLocal: boolean }
interface Devices { devices: Device[]; pending: Device[] }
interface Attachment { descriptor: { attachmentId: string; hookNodeId: string } }
const root = path.resolve(process.argv[2]);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { runtime, request } = await openProbe(root);

// The entire registry is private to this probe; competing pairing requests fail closed.
const pending = await until(() => request<Devices>('GET', '/v1/devices'),
    (value) => [...value.devices, ...value.pending].some((device) => device.approval === 'pending' && !device.isLocal), 'terminal pairing');
const candidates = [...new Map([...pending.devices, ...pending.pending]
    .filter((device) => device.approval === 'pending' && !device.isLocal).map((device) => [device.id, device])).values()];
if (candidates.length !== 1) throw new Error('Unexpected competing terminal pairing request');
runtime.deviceId = candidates[0].id;
await request('POST', `/v1/devices/${encodeURIComponent(runtime.deviceId)}/approve`, {});

// The GUI uses this machine's real persisted identity; only the Rust fixture needs synthetic keys.
const source: { id: string; token?: string } = process.argv[3] === 'gui'
    ? { id: runtime.deviceId } : await nativeIdentity();

const zip = await readFile(path.resolve(repo, '../Loom/target/surface-smoke-arts/surface-prototype-stock-card.zip'));
await request('POST', '/v1/frameworks/process/install', {});
await request('POST', '/v1/arts/install', { zipBase64: zip.toString('base64') });
const attached = await request<{ instance: { descriptor: { instanceId: string }; attachments: Record<string, Attachment> } }>(
    'POST', '/v1/surfaces/attach', { artId: 'surface-stock-card', hookNodeId: 'hook-node:wall-input-source', deviceId: source.id });
const attachment = Object.values(attached.instance.attachments).find((value) => value.descriptor.hookNodeId === 'hook-node:wall-input-source');
if (!attachment) throw new Error('Native source Surface attachment is missing');
const fixture = await readJson<{ hwnd: string }>(path.join(root, 'fixture-ready.json'));
await writeJson(path.join(root, 'source-private.json'), {
    baseUrl: runtime.daemonBaseUrl, sourceDeviceId: source.id, sourceToken: source.token,
    surfaceInstanceId: attached.instance.descriptor.instanceId, sourceAttachmentId: attachment.descriptor.attachmentId,
    hwnd: BigInt(fixture.hwnd).toString(), durationSeconds: Math.max(600, (runtime.soakSeconds ?? 0) + 300),
});
await writeJson(path.join(root, 'runtime.json'), runtime);
console.log(JSON.stringify({ terminalDeviceId: runtime.deviceId, sourceDeviceId: source.id, sourcePrepared: true }));

async function nativeIdentity(): Promise<{ id: string; token: string }> {
    const keys = generateKeyPairSync('ed25519');
    const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
    const name = `Wall native source ${randomUUID()}`;
    const created = await request<Devices>('POST', '/v1/devices/requests', {
        name, kind: 'computer', address: '127.0.0.1', publicKey,
    }, false);
    const source = created.pending.find((device) => device.name === name);
    if (!source) throw new Error('Native source pairing did not return the requested identity');
    await request('POST', `/v1/devices/${encodeURIComponent(source.id)}/approve`, {});
    const challenge = await request<{ challengeId: string; challenge: string }>('POST', '/v1/device-sessions/challenges', { deviceId: source.id }, false);
    const clientNonce = randomUUID();
    const signed = Buffer.from(['loom.device-session.v1', source.id, challenge.challengeId, challenge.challenge, clientNonce].join('\n'));
    const session = await request<{ token: string }>('POST', '/v1/device-sessions', {
        deviceId: source.id, challengeId: challenge.challengeId, clientNonce,
        signature: sign(null, signed, keys.privateKey).toString('base64'),
    }, false);
    if (!session.token) throw new Error('Native source session token is missing');
    return { id: source.id, token: session.token };
}
