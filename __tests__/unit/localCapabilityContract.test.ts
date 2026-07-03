import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildLocalCapabilityInvokeRequest,
  isLoopbackHttpBaseUrl,
  isLocalCapabilityManifest,
  isLocalCapabilityInvokeRequest,
  isLocalCapabilityInvokeResponse,
  isSupportedLocalCapabilityManifest,
  type LocalCapabilityManifest,
} from '../../../contracts/local-capability/typescript/localCapability';

const repoRoot = resolve(process.cwd(), '..');
const contractRoot = resolve(repoRoot, 'contracts/local-capability');

const readJson = (relativePath: string): unknown => JSON.parse(
  readFileSync(resolve(contractRoot, relativePath), 'utf8'),
);

describe('Neuro local capability contract', () => {
  it('keeps root contract schemas and examples as the cross-project source of truth', () => {
    const manifestSchemaPath = resolve(contractRoot, 'manifest.schema.json');
    const invokeRequestSchemaPath = resolve(contractRoot, 'invoke-request.schema.json');
    const invokeResponseSchemaPath = resolve(contractRoot, 'invoke-response.schema.json');

    expect(existsSync(manifestSchemaPath)).toBe(true);
    expect(existsSync(invokeRequestSchemaPath)).toBe(true);
    expect(existsSync(invokeResponseSchemaPath)).toBe(true);

    const manifestSchema = readJson('manifest.schema.json') as Record<string, unknown>;
    expect(manifestSchema['$id']).toBe('https://neuro.local/schemas/local-capability/manifest.schema.json');

    const talkManifest = readJson('examples/talk-manifest.json');
    expect(isSupportedLocalCapabilityManifest(talkManifest, {
      appId: 'talk',
      capability: 'voice.capture.once',
    })).toBe(true);

    const loomManifest = readJson('examples/loom-manifest.json');
    expect(isSupportedLocalCapabilityManifest(loomManifest, {
      appId: 'loom',
      capability: 'brain.plan',
    })).toBe(true);

    const talkInvoke = readJson('examples/talk-invoke-request.json');
    expect(isLocalCapabilityInvokeRequest(talkInvoke, {
      caller: 'hook',
      capability: 'voice.capture.once',
    })).toBe(true);

    const loomInvoke = readJson('examples/loom-invoke-request.json');
    expect(isLocalCapabilityInvokeRequest(loomInvoke, {
      caller: 'hook',
      capability: 'brain.plan',
    })).toBe(true);

    const succeeded = readJson('examples/invoke-response-succeeded.json');
    const failed = readJson('examples/invoke-response-failed.json');
    expect(isLocalCapabilityInvokeResponse(succeeded)).toBe(true);
    expect(isLocalCapabilityInvokeResponse(failed)).toBe(true);
  });

  it('accepts a loopback Talk manifest with the required voice capability', () => {
    const manifest: LocalCapabilityManifest = {
      schemaVersion: 1,
      appId: 'talk',
      displayName: 'Talk',
      version: '0.1.0',
      pid: 123,
      transport: {
        type: 'http',
        baseUrl: 'http://127.0.0.1:49210',
        auth: 'bearer',
        authToken: 'local-token',
      },
      capabilities: ['voice.capture.once'],
      startedAt: '2026-06-08T00:00:00+08:00',
    };

    expect(isSupportedLocalCapabilityManifest(manifest, {
      appId: 'talk',
      capability: 'voice.capture.once',
    })).toBe(true);
  });

  it('accepts a loopback Loom manifest with the required brain capability', () => {
    const manifest: LocalCapabilityManifest = {
      schemaVersion: 1,
      appId: 'loom',
      displayName: 'Loom',
      version: '0.1.0',
      pid: 456,
      transport: {
        type: 'http',
        baseUrl: 'http://127.0.0.1:8765',
        auth: 'none',
      },
      capabilities: ['brain.plan'],
      startedAt: 1780861361,
    };

    expect(isSupportedLocalCapabilityManifest(manifest, {
      appId: 'loom',
      capability: 'brain.plan',
    })).toBe(true);
  });

  it('rejects non-loopback capability transports by default', () => {
    expect(isLoopbackHttpBaseUrl('http://127.0.0.1:49210')).toBe(true);
    expect(isLoopbackHttpBaseUrl('http://127.0.0.2:49210')).toBe(true);
    expect(isLoopbackHttpBaseUrl('http://localhost:49210')).toBe(true);
    expect(isLoopbackHttpBaseUrl('http://[::1]:49210')).toBe(true);
    expect(isLoopbackHttpBaseUrl('http://192.168.1.2:49210')).toBe(false);
    expect(isLoopbackHttpBaseUrl('https://127.0.0.1:49210')).toBe(false);
    expect(isLoopbackHttpBaseUrl('http://127.0.0.1:49210/api')).toBe(false);
    expect(isLoopbackHttpBaseUrl('http://127.0.0.1:49210?proxy=1')).toBe(false);
    expect(isLoopbackHttpBaseUrl('http://127.0.0.1:49210/#fragment')).toBe(false);
    expect(isLoopbackHttpBaseUrl('http://user:secret@127.0.0.1:49210')).toBe(false);
  });

  it('safely rejects malformed or unactionable manifests without throwing', () => {
    expect(isSupportedLocalCapabilityManifest({
      schemaVersion: 1,
      appId: 'talk',
      displayName: 'Talk',
      version: '0.1.0',
      pid: 123,
      transport: {
        type: 'http',
        baseUrl: 'http://127.0.0.1:49210',
        auth: 'bearer',
      },
      capabilities: ['voice.capture.once'],
      startedAt: 1780861361,
    }, {
      appId: 'talk',
      capability: 'voice.capture.once',
    })).toBe(false);

    expect(() => isSupportedLocalCapabilityManifest({
      schemaVersion: 1,
      appId: 'talk',
    } as unknown, {
      appId: 'talk',
      capability: 'voice.capture.once',
    })).not.toThrow();
    expect(isSupportedLocalCapabilityManifest({
      schemaVersion: 1,
      appId: 'talk',
    } as unknown, {
      appId: 'talk',
      capability: 'voice.capture.once',
    })).toBe(false);

    expect(isSupportedLocalCapabilityManifest({
      schemaVersion: 1,
      appId: 'talk',
      displayName: 'Talk',
      version: '0.1.0',
      pid: 123.45,
      transport: {
        type: 'http',
        baseUrl: 'http://127.0.0.1:49210',
        auth: 'bearer',
        authToken: 'local-token',
      },
      capabilities: ['voice.capture.once'],
      startedAt: 1780861361,
    }, {
      appId: 'talk',
      capability: 'voice.capture.once',
    })).toBe(false);

    expect(isSupportedLocalCapabilityManifest({
      schemaVersion: 1,
      appId: 'talk',
      displayName: 'Talk',
      version: '0.1.0',
      pid: 123,
      transport: {
        type: 'http',
        baseUrl: 'http://127.0.0.1:49210',
        auth: 'bearer',
        authToken: 'local-token',
      },
      capabilities: ['voice.capture.once', 'voice.capture.once'],
      startedAt: 1780861361,
    }, {
      appId: 'talk',
      capability: 'voice.capture.once',
    })).toBe(false);

    expect(isLocalCapabilityManifest({
      schemaVersion: 1,
      appId: 'talk',
      displayName: 'Talk',
      version: '0.1.0',
      pid: 123,
      transport: {
        type: 'http',
        baseUrl: 'http://127.0.0.1:49210',
        auth: 'bearer',
        authToken: 'local-token',
      },
      capabilities: [''],
      startedAt: 1780861361,
    })).toBe(false);
  });

  it('builds the unified invoke envelope used by Hook, Talk, and Loom', () => {
    const request = buildLocalCapabilityInvokeRequest({
      requestId: 'request-1',
      caller: 'hook',
      capability: 'voice.capture.once',
      input: { mode: 'dictation' },
    });

    expect(request).toEqual({
      requestId: 'request-1',
      caller: 'hook',
      capability: 'voice.capture.once',
      input: { mode: 'dictation' },
    });
    expect(isLocalCapabilityInvokeRequest(request, {
      caller: 'hook',
      capability: 'voice.capture.once',
    })).toBe(true);
    expect(isLocalCapabilityInvokeRequest({
      requestId: '',
      caller: 'hook',
      capability: 'voice.capture.once',
      input: {},
    })).toBe(false);
  });

  it('validates unified invoke responses at runtime', () => {
    expect(isLocalCapabilityInvokeResponse({
      requestId: 'request-1',
      status: 'succeeded',
      output: { runId: 'run-1' },
    })).toBe(true);

    expect(isLocalCapabilityInvokeResponse({
      requestId: 'request-1',
      status: 'failed',
      error: {
        code: 'unknown_capability',
        message: 'unknown capability',
      },
    })).toBe(true);

    expect(isLocalCapabilityInvokeResponse({
      requestId: 'request-1',
      status: 'failed',
      error: {
        code: '',
        message: '',
      },
    })).toBe(false);
  });
});
