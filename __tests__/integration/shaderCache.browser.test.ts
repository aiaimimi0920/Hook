import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const installBrowserGlobals = () => {
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    },
  });
};

describe('shaderCache browser mode', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    installBrowserGlobals();
  });

  afterEach(async () => {
    const { shaderCache } = await import('../../src/services/shaderCache');
    shaderCache.clear();
    vi.unstubAllGlobals();
  });

  it('prefetchShader short-circuits to null when Tauri runtime is unavailable', async () => {
    const { shaderCache } = await import('../../src/services/shaderCache');

    await expect(
      shaderCache.prefetchShader('shader-art-1', 'C:/fake/path.py')
    ).resolves.toBeNull();

    expect(shaderCache.hasShaderCode('shader-art-1')).toBe(false);
    expect(shaderCache.getCachedArtIds()).toEqual([]);
  });
});
