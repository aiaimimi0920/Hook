import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLocalStorageMock,
  installBrowserGlobals,
  MockWebSocket,
} from '../helpers/browserApiTestHarness';

describe('Hook api browser persistence and fallbacks', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    MockWebSocket.instances = [];
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('saveSession compacts oversized browser preview payloads after quota failure', async () => {
    const localStorageMock = createLocalStorageMock();
    const quotaError = new Error('Quota exceeded');
    localStorageMock.setItem
      .mockImplementationOnce(() => {
        throw quotaError;
      })
      .mockImplementation((key: string, value: string) => {
        localStorageMock.setRaw(key, value);
      });

    installBrowserGlobals(localStorageMock);
    const { api } = await import('../../src/services/api');

    const hugeDataUrl = `data:image/png;base64,${'A'.repeat(10000)}`;
    const frozenEntry = {
      entryId: 'frozen-1',
      sourceStickerId: 'u-1',
      createdAt: '2026-08-23T00:00:00.000Z',
      snapshot: {
        id: 'u-1',
        src: hugeDataUrl,
        x: 0,
        y: 0,
        w: 320,
        h: 180,
        minified: false,
        savedRect: null,
        cropOffset: null,
        opacityNormal: 1,
        opacityMini: 0.9,
        previewSrc: hugeDataUrl,
        filePath: null,
        rasterizedAnnotationLayerSrc: hugeDataUrl,
        annotationState: null,
        imageEditState: null,
        captureMeta: null,
      },
    };
    await api.saveSession(
      [
        {
          id: 'u-1',
          x: 0,
          y: 0,
          w: 320,
          h: 180,
          src: hugeDataUrl,
          previewSrc: hugeDataUrl,
        },
      ],
      [],
      [],
      [frozenEntry],
      [frozenEntry],
    );

    expect(localStorageMock.setItem).toHaveBeenCalledTimes(2);
    const compactPayload = JSON.parse(localStorageMock.setItem.mock.calls[1][1]);
    expect(compactPayload.stickers[0].src).toBeNull();
    expect(compactPayload.stickers[0].previewSrc).toBeNull();
    expect(compactPayload.recycleBin[0].snapshot.src).toBe('');
    expect(compactPayload.recycleBin[0].snapshot.previewSrc).toBeNull();
    expect(compactPayload.referenceLibrary[0].snapshot.rasterizedAnnotationLayerSrc).toBeNull();
  });

  it('saveSession rejects instead of reporting a revision when both browser writes fail', async () => {
    const localStorageMock = createLocalStorageMock();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    localStorageMock.setItem.mockImplementation(() => {
      throw new Error('Persistent browser storage failure');
    });
    installBrowserGlobals(localStorageMock);
    const { api } = await import('../../src/services/api');

    await expect(api.saveSession([], [])).rejects.toThrow('Persistent browser storage failure');
    expect(localStorageMock.setItem).toHaveBeenCalledTimes(2);
    expect(localStorageMock.dump()).toEqual({});
    expect(warn).toHaveBeenCalledWith(
      '[API] Failed to save browser preview session:',
      expect.any(Error),
    );
  });

  it('saveSession compares and advances the browser document revision', async () => {
    const localStorageMock = installBrowserGlobals();
    const { api } = await import('../../src/services/api');

    await expect(api.saveSession([], [], [], [], [], { workflows: {} }, 0)).resolves.toEqual({
      documentRevision: 1,
    });
    await expect(api.saveSession([], [], [], [], [], { workflows: {} }, 0)).rejects.toThrow(
      'SESSION_REVISION_CONFLICT expected 0, current 1',
    );

    const stored = JSON.parse(Object.values(localStorageMock.dump())[0]);
    expect(stored).toMatchObject({ documentSchemaVersion: 1, documentRevision: 1 });
  });

  it('loadSession rejects a future browser document schema without overwriting it', async () => {
    const localStorageMock = createLocalStorageMock();
    const future = JSON.stringify({
      documentSchemaVersion: 2,
      documentRevision: 7,
      stickers: [],
      links: [],
    });
    localStorageMock.setRaw('hook_browser_preview_session', future);
    installBrowserGlobals(localStorageMock);
    const { api } = await import('../../src/services/api');

    await expect(api.loadSession()).rejects.toThrow('SESSION_SCHEMA_UNSUPPORTED');
    expect(Object.values(localStorageMock.dump())).toContain(future);
  });

  it('loadSession rejects malformed nested browser session records without overwriting them', async () => {
    const localStorageMock = createLocalStorageMock();
    installBrowserGlobals(localStorageMock);
    const { api } = await import('../../src/services/api');
    const base = {
      documentSchemaVersion: 1,
      documentRevision: 7,
      stickers: [],
      links: [],
    };
    const malformedRecords = [
      { ...base, stickers: [{}] },
      { ...base, links: [{}] },
      { ...base, groups: [null] },
      { ...base, workflowAssetArchiveIndex: {} },
    ];

    for (const record of malformedRecords) {
      const raw = JSON.stringify(record);
      localStorageMock.setRaw('hook_browser_preview_session', raw);
      await expect(api.loadSession()).rejects.toThrow('SESSION_SCHEMA_INVALID');
      expect(localStorageMock.dump().hook_browser_preview_session).toBe(raw);
    }
  });

  it('loadAppSettings returns isolated browser fallback objects', async () => {
    installBrowserGlobals();
    const { api } = await import('../../src/services/api');

    const first = await api.loadAppSettings();
    const originalRecycleLimit = first.cache.recycleBinMaxEntries;
    first.cache.recycleBinMaxEntries = originalRecycleLimit + 1;
    const second = await api.loadAppSettings();

    expect(second.cache.recycleBinMaxEntries).toBe(originalRecycleLimit);
    expect(second.cache).not.toBe(first.cache);
    expect(second.fileNaming).not.toBe(first.fileNaming);
  });

  it('getVoiceSettingsSummary returns isolated browser fallback objects', async () => {
    installBrowserGlobals();
    const { api } = await import('../../src/services/api');

    const first = await api.getVoiceSettingsSummary();
    const originalShortcut = first.shortcut;
    first.shortcut = 'Modified by caller';
    const second = await api.getVoiceSettingsSummary();

    expect(second.shortcut).toBe(originalShortcut);
    expect(second).not.toBe(first);
  });

  it('browser handshake failures return isolated capability trees', async () => {
    installBrowserGlobals();
    vi.stubGlobal('WebSocket', undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { browserHandshakeFallback } = await import('../../src/services/apiBrowserLoomTransport');

    const first = await browserHandshakeFallback();
    first.capabilities.operations.push('modified-by-caller');
    const second = await browserHandshakeFallback();

    expect(second.capabilities.operations).toEqual([]);
    expect(second.capabilities).not.toBe(first.capabilities);
    expect(second.capabilities.surface).not.toBe(first.capabilities.surface);
  });

  it('prefetchShader returns unsupported fallback in browser preview mode', async () => {
    installBrowserGlobals();
    const { api } = await import('../../src/services/api');

    await expect(
      api.prefetchShader({
        artId: 'shader-1',
        inputPath: null,
        referencePath: null,
      })
    ).resolves.toMatchObject({
      type: 'unsupported',
      success: false,
    });
  });

  it('performOcr delegates to the Loom Hook websocket request path', async () => {
    installBrowserGlobals();
    const { api } = await import('../../src/services/api');

    const pending = api.performOcr('data:image/png;base64,abc123');

    const socket = MockWebSocket.instances.at(-1);
    expect(socket).toBeTruthy();

    socket!.open();
    const ocrRequest = JSON.parse(socket!.sent[0]);
    expect(ocrRequest).toMatchObject({
      method: 'loom.hook.ocr.execute',
      params: { imageBase64: 'data:image/png;base64,abc123' },
    });

    socket!.emitMessage({
      protocolVersion: 'loom.hook.v1',
      requestId: ocrRequest.params.requestId,
      status: 'succeeded',
      data: {
        fullText: 'hello',
        textBlocks: [],
      },
    });

    await expect(pending).resolves.toMatchObject({
      fullText: 'hello',
      textBlocks: [],
    });
  });

  it('translateText delegates to the Loom Hook websocket request path', async () => {
    installBrowserGlobals();
    const { api } = await import('../../src/services/api');

    const pending = api.translateText('hello', 'zh');

    const socket = MockWebSocket.instances.at(-1);
    expect(socket).toBeTruthy();

    socket!.open();
    const translationRequest = JSON.parse(socket!.sent[0]);
    expect(translationRequest).toMatchObject({
      method: 'loom.hook.translation.execute',
      params: { text: 'hello', targetLanguage: 'zh' },
    });

    socket!.emitMessage({
      protocolVersion: 'loom.hook.v1',
      requestId: translationRequest.params.requestId,
      status: 'succeeded',
      data: {
        translatedText: '你好',
      },
    });

    await expect(pending).resolves.toBe('你好');
  });

  it('createTeaTicket is Tauri-only and rejects in browser preview mode', async () => {
    installBrowserGlobals();
    const { api } = await import('../../src/services/api');

    await expect(
      api.createTeaTicket({
        source: 'hook-browser-preview',
        text: 'Create a Tea ticket from Hook',
        context: {
          active_window: 'Browser Preview',
          selection_text: 'selected text',
          ocr_text: null,
          screenshot_ref: null,
          cwd: 'C:\\repo',
          app: 'hook',
        },
        attachments: [],
      }),
    ).rejects.toThrow('Tea ticket creation requires the Tauri desktop runtime');
  });

  it('invokeLoomBrainPlan is Tauri-only and rejects in browser preview mode', async () => {
    installBrowserGlobals();
    const { api } = await import('../../src/services/api');

    await expect(
      api.invokeLoomBrainPlan({
        goal: 'Plan from browser preview',
      }),
    ).rejects.toThrow('Loom brain planning requires the Tauri desktop runtime');
  });
});
