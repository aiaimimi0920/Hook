import { ShaderRenderer, type ShaderSuccessResponse } from "../src/components/ShaderRenderer";

interface ShaderBenchmarkMetric {
  p50Ms: number;
  p95Ms: number;
  samples: number;
}

interface ShaderResolutionBenchmark {
  width: number;
  height: number;
  pixels: number;
  rehydration: ShaderBenchmarkMetric;
  adjustment: ShaderBenchmarkMetric;
}

interface ShaderBenchmarkOptions {
  restoreIterations?: number;
  adjustmentIterations?: number;
}

interface ShaderBenchmarkReport {
  exportSmoke: {
    blobBytes: number;
    alpha: number;
  };
  resolutions: ShaderResolutionBenchmark[];
}

const SHADER_RESPONSE: ShaderSuccessResponse = {
  type: "shader",
  vertex_shader: `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = (a_position + 1.0) * 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`,
  fragment_shader: `#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_strength;
in vec2 v_uv;
out vec4 out_color;
void main() {
  vec4 color = texture(u_input, v_uv);
  out_color = vec4(mix(color.rgb, 1.0 - color.rgb, u_strength), color.a);
}`,
  uniforms: { strength: 0 },
  success: true,
};

const RESOLUTIONS = [
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
] as const;

const summarize = (samples: number[]): ShaderBenchmarkMetric => {
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (ratio: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))] ?? 0;
  return {
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    samples: sorted.length,
  };
};

const forceGpuCompletion = (canvas: HTMLCanvasElement) => {
  const gl = canvas.getContext("webgl2");
  if (!gl) throw new Error("WebGL2 became unavailable during the benchmark");
  // Benchmark-only 1x1 synchronization. Production rendering performs no
  // framebuffer readback during restore or live parameter adjustment.
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
};

const createReadyRenderer = (width: number, height: number) => {
  const outputCanvas = document.createElement("canvas");
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const renderer = new ShaderRenderer(outputCanvas);
  if (!renderer.initFromShaderResponse(SHADER_RESPONSE)) {
    renderer.dispose();
    throw new Error("Failed to initialize the benchmark shader");
  }
  renderer.loadTexture("input", sourceCanvas);
  renderer.render();
  forceGpuCompletion(outputCanvas);
  return { renderer, outputCanvas, sourceCanvas };
};

const verifyCanvasExport = async () => {
  const resources = createReadyRenderer(64, 64);
  const sourceContext = resources.sourceCanvas.getContext("2d");
  if (!sourceContext) throw new Error("2D canvas is unavailable for export smoke validation");
  sourceContext.fillStyle = "rgba(255, 64, 32, 1)";
  sourceContext.fillRect(0, 0, 64, 64);
  resources.renderer.loadTexture("input", resources.sourceCanvas);
  resources.renderer.render();

  const blob = await new Promise<Blob>((resolve, reject) => {
    resources.outputCanvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("WebGL canvas toBlob returned no PNG"));
    }, "image/png");
  });
  const bitmap = await createImageBitmap(blob);
  const inspectionCanvas = document.createElement("canvas");
  inspectionCanvas.width = 1;
  inspectionCanvas.height = 1;
  const inspectionContext = inspectionCanvas.getContext("2d");
  if (!inspectionContext) throw new Error("2D canvas is unavailable for PNG inspection");
  inspectionContext.drawImage(bitmap, 0, 0, 1, 1);
  const alpha = inspectionContext.getImageData(0, 0, 1, 1).data[3] ?? 0;

  bitmap.close();
  resources.renderer.dispose();
  resources.sourceCanvas.width = 0;
  resources.sourceCanvas.height = 0;
  resources.outputCanvas.width = 0;
  resources.outputCanvas.height = 0;
  inspectionCanvas.width = 0;
  inspectionCanvas.height = 0;

  if (alpha === 0) {
    throw new Error("WebGL canvas PNG export was fully transparent");
  }
  return { blobBytes: blob.size, alpha };
};

const benchmarkResolution = (
  width: number,
  height: number,
  options: Required<ShaderBenchmarkOptions>,
): ShaderResolutionBenchmark => {
  const restoreSamples: number[] = [];
  for (let iteration = -1; iteration < options.restoreIterations; iteration += 1) {
    const startedAt = performance.now();
    const resources = createReadyRenderer(width, height);
    const elapsed = performance.now() - startedAt;
    resources.renderer.dispose();
    resources.sourceCanvas.width = 0;
    resources.sourceCanvas.height = 0;
    resources.outputCanvas.width = 0;
    resources.outputCanvas.height = 0;
    if (iteration >= 0) restoreSamples.push(elapsed);
  }

  const resources = createReadyRenderer(width, height);
  for (let iteration = 0; iteration < 5; iteration += 1) {
    resources.renderer.setUniform("strength", iteration / 5);
    resources.renderer.render();
    forceGpuCompletion(resources.outputCanvas);
  }

  const adjustmentSamples: number[] = [];
  for (let iteration = 0; iteration < options.adjustmentIterations; iteration += 1) {
    const startedAt = performance.now();
    resources.renderer.setUniform("strength", iteration / options.adjustmentIterations);
    resources.renderer.render();
    forceGpuCompletion(resources.outputCanvas);
    adjustmentSamples.push(performance.now() - startedAt);
  }
  resources.renderer.dispose();
  resources.sourceCanvas.width = 0;
  resources.sourceCanvas.height = 0;
  resources.outputCanvas.width = 0;
  resources.outputCanvas.height = 0;

  return {
    width,
    height,
    pixels: width * height,
    rehydration: summarize(restoreSamples),
    adjustment: summarize(adjustmentSamples),
  };
};

window.runHookShaderBenchmark = async (options = {}): Promise<ShaderBenchmarkReport> => {
  const normalizedOptions: Required<ShaderBenchmarkOptions> = {
    restoreIterations: Math.max(1, Math.floor(options.restoreIterations ?? 5)),
    adjustmentIterations: Math.max(1, Math.floor(options.adjustmentIterations ?? 30)),
  };

  const exportSmoke = await verifyCanvasExport();
  const resolutions: ShaderResolutionBenchmark[] = [];
  for (const resolution of RESOLUTIONS) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    resolutions.push(benchmarkResolution(resolution.width, resolution.height, normalizedOptions));
  }
  return { exportSmoke, resolutions };
};

declare global {
  interface Window {
    runHookShaderBenchmark: (
      options?: ShaderBenchmarkOptions,
    ) => Promise<ShaderBenchmarkReport>;
  }
}
