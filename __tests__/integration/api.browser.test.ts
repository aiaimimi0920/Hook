import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installBrowserGlobals, MockWebSocket } from '../helpers/browserApiTestHarness';

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

  it('request sockets close immediately when Loom sends malformed JSON', async () => {
    installBrowserGlobals();
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    const { api } = await import('../../src/services/api');

    const pending = api.performOcr('data:image/png;base64,abc123');
    const socket = MockWebSocket.instances.at(-1)!;
    socket.open();
    socket.emitRawMessage('{');

    await expect(pending).rejects.toBeInstanceOf(SyntaxError);
    expect(clearTimeoutSpy).toHaveBeenCalledOnce();
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
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
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);

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

  it('browser push socket refreshes subscriptions when listener methods change', async () => {
    installBrowserGlobals();
    const { listenBrowserLoomHookMethod } = await import('../../src/services/api');
    const workflowHandler = vi.fn();
    const artHandler = vi.fn();

    const unlistenWorkflow = listenBrowserLoomHookMethod(
      'loom.hook.workflow.instantiated',
      workflowHandler,
    );
    const socket = MockWebSocket.instances.at(-1)!;
    socket.open();

    const unlistenArt = listenBrowserLoomHookMethod('loom.hook.art.progress', artHandler);
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({
      method: 'loom.hook.subscribe',
      params: {
        events: ['loom.hook.workflow.instantiated', 'loom.hook.art.progress'],
      },
    });

    socket.emitMessage({
      protocolVersion: 'loom.hook.v1',
      method: 'loom.hook.art.progress',
      params: { requestId: 'art:req-1', progress: 0.5 },
    });
    expect(artHandler).toHaveBeenCalledWith({ requestId: 'art:req-1', progress: 0.5 });

    unlistenWorkflow();
    expect(socket.readyState).toBe(MockWebSocket.OPEN);
    unlistenArt();
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
  });

});
