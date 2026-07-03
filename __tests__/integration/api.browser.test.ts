import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MessageHandler = (event: { data: string }) => void;

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readonly sent: string[] = [];
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: MessageHandler | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  emitMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

const createLocalStorageMock = () => {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
    setRaw: (key: string, value: string) => {
      store.set(key, value);
    },
    dump: () => Object.fromEntries(store.entries()),
  };
};

const installBrowserGlobals = (localStorageMock = createLocalStorageMock()) => {
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    localStorage: localStorageMock,
  });
  return localStorageMock;
};

describe('Hook api browser mode', () => {
  beforeEach(() => {
    vi.resetModules();
    MockWebSocket.instances = [];
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dispatchAction request sockets ignore push frames and resolve on typed responses', async () => {
    installBrowserGlobals();
    const { api } = await import('../../src/services/api');

    const pending = api.dispatchAction({
      action: 'update_node_param',
      payload: {
        origin_workflow_id: 'wf-1',
        origin_node_id: 'node-1',
        param_key: 'strength',
        value: 42,
      },
    });

    const socket = MockWebSocket.instances.at(-1);
    expect(socket).toBeTruthy();

    socket!.open();
    expect(socket!.sent).toEqual([
      JSON.stringify({
        method: 'art_loom/update_workflow_node',
        params: {
          workflow_id: 'wf-1',
          node_id: 'node-1',
          param: 'strength',
          value: 42,
        },
      }),
    ]);

    socket!.emitMessage({
      method: 'art_loom/workflow_updated',
      params: { workflowId: 'wf-1' },
    });
    socket!.emitMessage({ type: 'success' });

    await expect(pending).resolves.toBeUndefined();
  });

  it('browser push socket subscribes and only dispatches method payloads', async () => {
    installBrowserGlobals();
    const { listenBrowserArtLoomMethod } = await import('../../src/services/api');
    const handler = vi.fn();

    const unlisten = listenBrowserArtLoomMethod('art_hook/instantiate', handler);
    const socket = MockWebSocket.instances.at(-1);
    expect(socket).toBeTruthy();

    socket!.open();
    expect(socket!.sent).toEqual([
      JSON.stringify({
        method: 'subscribe',
        params: { channels: ['art_hook/instantiate'] },
      }),
    ]);

    socket!.emitMessage({ type: 'success', data: { ignored: true } });
    expect(handler).not.toHaveBeenCalled();

    socket!.emitMessage({
      method: 'art_hook/instantiate',
      params: { workflow_id: 'wf-1', nodes: [] },
    });
    expect(handler).toHaveBeenCalledWith({ workflow_id: 'wf-1', nodes: [] });

    unlisten();
    expect(socket!.readyState).toBe(MockWebSocket.CLOSED);
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
    await api.saveSession(
      [
        {
          id: 'u-1',
          src: hugeDataUrl,
          previewSrc: hugeDataUrl,
        },
      ],
      []
    );

    expect(localStorageMock.setItem).toHaveBeenCalledTimes(2);
    const compactPayload = JSON.parse(localStorageMock.setItem.mock.calls[1][1]);
    expect(compactPayload.stickers[0].src).toBeNull();
    expect(compactPayload.stickers[0].previewSrc).toBeNull();
  });

  it('prefetchShader returns unsupported fallback in browser preview mode', async () => {
    installBrowserGlobals();
    const { api } = await import('../../src/services/api');

    await expect(
      api.prefetchShader({
        artId: 'shader-1',
        artPath: null,
        inputPath: null,
        referencePath: null,
      })
    ).resolves.toMatchObject({
      type: 'unsupported',
      success: false,
    });
  });

  it('performOcr delegates to the ArtLoom IPC websocket request path', async () => {
    installBrowserGlobals();
    const { api } = await import('../../src/services/api');

    const pending = api.performOcr('data:image/png;base64,abc123');

    const socket = MockWebSocket.instances.at(-1);
    expect(socket).toBeTruthy();

    socket!.open();
    expect(socket!.sent).toEqual([
      JSON.stringify({
        method: 'art_loom/ocr_image',
        params: {
          image_base64: 'data:image/png;base64,abc123',
        },
      }),
    ]);

    socket!.emitMessage({
      type: 'success',
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

  it('translateText delegates to the ArtLoom IPC websocket request path', async () => {
    installBrowserGlobals();
    const { api } = await import('../../src/services/api');

    const pending = api.translateText('hello', 'zh');

    const socket = MockWebSocket.instances.at(-1);
    expect(socket).toBeTruthy();

    socket!.open();
    expect(socket!.sent).toEqual([
      JSON.stringify({
        method: 'art_loom/translate_text',
        params: {
          text: 'hello',
          target_lang: 'zh',
        },
      }),
    ]);

    socket!.emitMessage({
      type: 'success',
      data: {
        translated_text: '你好',
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
