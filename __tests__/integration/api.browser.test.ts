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
  const target = new EventTarget();
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    localStorage: localStorageMock,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
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
      action: 'update_workflow_node',
      payload: {
        request_id: 'workflow-node-update:req-1',
        workflow_id: 'wf-1',
        node_id: 'node-1',
        parameter_id: 'strength',
        value: 42,
      },
    });

    const socket = MockWebSocket.instances.at(-1);
    expect(socket).toBeTruthy();

    socket!.open();
    expect(JSON.parse(socket!.sent[0])).toMatchObject({
      method: 'loom.hook.workflow.node.update',
      params: {
        workflowId: 'wf-1',
        nodeId: 'node-1',
        parameterId: 'strength',
        requestId: 'workflow-node-update:req-1',
        value: 42,
      },
    });

    socket!.emitMessage({
      method: 'loom.hook.workflow.updated',
      params: { workflowId: 'wf-1' },
    });
    socket!.emitMessage({
      protocolVersion: 'loom.hook.v1',
      requestId: 'workflow-node-update:req-1',
      status: 'succeeded',
    });

    await expect(pending).resolves.toBeUndefined();
  });

  it('browser Art execution emits the formal terminal delivery', async () => {
    installBrowserGlobals();
    const ready = vi.fn();
    window.addEventListener('hook-browser-art-ready', ready);
    const { api } = await import('../../src/services/api');

    const pending = api.dispatchAction({
      action: 'execute_art',
      payload: {
        node_id: 'node-art',
        request_id: 'art:req-1',
        generation: 1,
        art_id: 'publisher/art',
        inputs: {},
        parameters: {},
        disabled_parameters: [],
      },
    });
    const socket = MockWebSocket.instances.at(-1)!;
    socket.open();
    socket.emitMessage({
      protocolVersion: 'loom.hook.v1',
      requestId: 'art:req-1',
      status: 'succeeded',
      data: {
        protocolVersion: 'loom.hook.v1',
        requestId: 'art:req-1',
        nodeId: 'node-art',
        generation: 1,
        resultRevision: 1,
        outputs: { output: { kind: 'value', value: { ok: true } } },
      },
    });

    await expect(pending).resolves.toBeUndefined();
    expect(ready).toHaveBeenCalledOnce();
    expect((ready.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      art_id: 'node-art',
      request_id: 'art:req-1',
      phase: 'final',
      status: 200,
      delivery: { type: 'value', value: { ok: true }, outputs: { output: { ok: true } } },
    });
  });

  it('browser Art execution forwards every output port and prefers output_image', async () => {
    installBrowserGlobals();
    const ready = vi.fn();
    window.addEventListener('hook-browser-art-ready', ready);
    const { api } = await import('../../src/services/api');

    const pending = api.dispatchAction({
      action: 'execute_art',
      payload: {
        node_id: 'node-art',
        request_id: 'art:req-multi',
        generation: 1,
        art_id: 'publisher/art',
        inputs: {},
        parameters: {},
        disabled_parameters: [],
      },
    });
    const socket = MockWebSocket.instances.at(-1)!;
    socket.open();
    socket.emitMessage({
      protocolVersion: 'loom.hook.v1',
      requestId: 'art:req-multi',
      status: 'succeeded',
      data: {
        protocolVersion: 'loom.hook.v1',
        requestId: 'art:req-multi',
        nodeId: 'node-art',
        generation: 1,
        resultRevision: 1,
        outputs: {
          score: { kind: 'value', value: 0.9 },
          output_image: {
            kind: 'inline_resource',
            mime: 'image/png',
            dataBase64: 'QQ==',
            width: 1,
            height: 1,
          },
        },
      },
    });

    await expect(pending).resolves.toBeUndefined();
    expect((ready.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      delivery: {
        type: 'base64',
        data: 'data:image/png;base64,QQ==',
        outputs: {
          score: 0.9,
          output_image: 'data:image/png;base64,QQ==',
        },
      },
    });
  });

  it('browser Art execution fails closed when any formal output uses shared memory', async () => {
    installBrowserGlobals();
    const ready = vi.fn();
    window.addEventListener('hook-browser-art-ready', ready);
    const { api } = await import('../../src/services/api');

    const pending = api.dispatchAction({
      action: 'execute_art',
      payload: {
        node_id: 'node-art',
        request_id: 'art:req-shared',
        generation: 1,
        art_id: 'publisher/art',
        inputs: {},
        parameters: {},
        disabled_parameters: [],
      },
    });
    const socket = MockWebSocket.instances.at(-1)!;
    socket.open();
    socket.emitMessage({
      protocolVersion: 'loom.hook.v1',
      requestId: 'art:req-shared',
      status: 'succeeded',
      data: {
        protocolVersion: 'loom.hook.v1',
        requestId: 'art:req-shared',
        nodeId: 'node-art',
        generation: 1,
        resultRevision: 1,
        outputs: {
          score: { kind: 'value', value: 0.9 },
          shared: {
            kind: 'shared_memory',
            handle: 'Loom_Buffer_1',
            size: 8,
            width: 2,
            height: 1,
            format: 'rgba8',
          },
          output: { kind: 'value', value: { ok: true } },
        },
      },
    });

    await expect(pending).resolves.toBeUndefined();
    expect((ready.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      art_id: 'node-art',
      request_id: 'art:req-shared',
      status: 500,
      delivery: { type: 'base64' },
    });
    expect((ready.mock.calls[0][0] as CustomEvent).detail.error).toContain('shared-memory');
  });

  it('browser Art execution rejects malformed formal output values and result identities', async () => {
    for (const [requestId, data] of [
      [
        'art:req-bad-inline',
        {
          protocolVersion: 'loom.hook.v1',
          requestId: 'art:req-bad-inline',
          nodeId: 'node-art',
          generation: 1,
          resultRevision: 1,
          outputs: {
            output: { kind: 'inline_resource', mime: 'image/png', dataBase64: 'not base64!' },
          },
        },
      ],
      [
        'art:req-bad-value',
        {
          protocolVersion: 'loom.hook.v1',
          requestId: 'art:req-bad-value',
          nodeId: 'node-art',
          generation: 1,
          resultRevision: 1,
          outputs: { output: { kind: 'value' } },
        },
      ],
      [
        'art:req-bad-identity',
        {
          protocolVersion: 'loom.hook.v1',
          requestId: 'art:req-bad-identity',
          nodeId: 'other-node',
          generation: 1,
          resultRevision: 1,
          outputs: { output: { kind: 'value', value: true } },
        },
      ],
    ] as const) {
      installBrowserGlobals();
      const ready = vi.fn();
      window.addEventListener('hook-browser-art-ready', ready);
      const { api } = await import('../../src/services/api');

      const pending = api.dispatchAction({
        action: 'execute_art',
        payload: {
          node_id: 'node-art',
          request_id: requestId,
          generation: 1,
          art_id: 'publisher/art',
          inputs: {},
          parameters: {},
          disabled_parameters: [],
        },
      });
      const socket = MockWebSocket.instances.at(-1)!;
      socket.open();
      socket.emitMessage({
        protocolVersion: 'loom.hook.v1',
        requestId,
        status: 'succeeded',
        data,
      });

      await expect(pending).resolves.toBeUndefined();
      expect((ready.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
        art_id: 'node-art',
        request_id: requestId,
        status: 500,
      });
      vi.resetModules();
      vi.unstubAllGlobals();
      MockWebSocket.instances = [];
    }
  });

  it('browser Art cancel sends loom.hook.art.cancel and ignores request_not_found', async () => {
    installBrowserGlobals();
    const { api } = await import('../../src/services/api');

    const pending = api.dispatchAction({
      action: 'cancel_art',
      payload: {
        node_id: 'node-art',
        request_id: 'art:req-old',
        generation: 2,
      },
    });
    const socket = MockWebSocket.instances.at(-1)!;
    socket.open();
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      method: 'loom.hook.art.cancel',
      params: {
        protocolVersion: 'loom.hook.v1',
        requestId: 'art:req-old',
        nodeId: 'node-art',
        generation: 2,
        deviceId: 'device:browser-preview',
      },
    });
    socket.emitMessage({
      protocolVersion: 'loom.hook.v1',
      requestId: 'art:req-old',
      status: 'failed',
      error: { code: 'request_not_found', message: 'no active Art request matches requestId' },
    });

    await expect(pending).resolves.toBeUndefined();
  });

  it('browser Art execution emits a terminal failure when Loom is unreachable', async () => {
    installBrowserGlobals();
    const ready = vi.fn();
    window.addEventListener('hook-browser-art-ready', ready);
    const { api } = await import('../../src/services/api');

    const pending = api.dispatchAction({
      action: 'execute_art',
      payload: {
        node_id: 'node-art',
        request_id: 'art:req-fail',
        generation: 1,
        art_id: 'publisher/art',
        inputs: {},
        parameters: {},
        disabled_parameters: [],
      },
    });
    const socket = MockWebSocket.instances.at(-1)!;
    socket.onerror?.();

    await expect(pending).resolves.toBeUndefined();

    expect(ready).toHaveBeenCalledOnce();
    expect((ready.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      art_id: 'node-art',
      request_id: 'art:req-fail',
      status: 500,
      delivery: { type: 'base64' },
    });
    expect(typeof (ready.mock.calls[0][0] as CustomEvent).detail.error).toBe('string');
  });

  it('browser push socket subscribes and only dispatches method payloads', async () => {
    installBrowserGlobals();
    const { listenBrowserLoomHookMethod } = await import('../../src/services/api');
    const handler = vi.fn();

    const unlisten = listenBrowserLoomHookMethod('loom.hook.workflow.instantiated', handler);
    const socket = MockWebSocket.instances.at(-1);
    expect(socket).toBeTruthy();

    socket!.open();
    expect(JSON.parse(socket!.sent[0])).toMatchObject({
      method: 'loom.hook.subscribe',
      params: { events: ['loom.hook.workflow.instantiated'] },
    });

    socket!.emitMessage({ type: 'success', data: { ignored: true } });
    expect(handler).not.toHaveBeenCalled();

    socket!.emitMessage({
      method: 'loom.hook.workflow.instantiated',
      params: { workflowId: 'wf-1', nodes: [] },
    });
    expect(handler).not.toHaveBeenCalled();

    socket!.emitMessage({
      protocolVersion: 'loom.hook.v1',
      method: 'loom.hook.workflow.instantiated',
      params: { workflowId: 'wf-1', nodes: [] },
    });
    expect(handler).toHaveBeenCalledWith({ workflowId: 'wf-1', nodes: [] });

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
