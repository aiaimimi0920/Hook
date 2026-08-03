import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import { build } from "vite";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const buildResult = await build({
  configFile: false,
  root: projectRoot,
  logLevel: "error",
  build: {
    write: false,
    minify: false,
    target: "es2022",
    lib: {
      entry: resolve(projectRoot, "scripts/shader-benchmark-entry.ts"),
      name: "HookShaderBenchmark",
      formats: ["iife"],
      fileName: "hook-shader-benchmark",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
const buildOutputs = Array.isArray(buildResult) ? buildResult : [buildResult];
const benchmarkChunk = buildOutputs
  .flatMap((output) => output.output)
  .find((item) => item.type === "chunk");
if (!benchmarkChunk || benchmarkChunk.type !== "chunk") {
  throw new Error("Vite did not produce the shader benchmark bundle");
}

const parseIterationCount = (name, fallback) => {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const parsePositiveNumber = (name, fallback) => {
  const value = Number.parseFloat(process.env[name] ?? "");
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const benchmarkOptions = {
  restoreIterations: parseIterationCount("HOOK_SHADER_BENCH_RESTORE_ITERATIONS", 5),
  adjustmentIterations: parseIterationCount("HOOK_SHADER_BENCH_ADJUSTMENT_ITERATIONS", 30),
};
const enforcePerformanceBudgets = process.env.HOOK_SHADER_BENCH_ENFORCE === "1";
const performanceBudgets = {
  rehydrationP95Ms: parsePositiveNumber("HOOK_SHADER_BENCH_MAX_REHYDRATION_P95_MS", 5_000),
  adjustmentP95Ms: parsePositiveNumber("HOOK_SHADER_BENCH_MAX_ADJUSTMENT_P95_MS", 1_000),
};
const expectedResolutions = [
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
];

let browser;
try {
  const launchOptions = {
    headless: true,
    args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=swiftshader"],
  };
  try {
    browser = process.platform === "win32"
      ? await chromium.launch({ ...launchOptions, channel: "msedge" })
      : await chromium.launch(launchOptions);
  } catch {
    browser = process.platform === "win32"
      ? await chromium.launch(launchOptions)
      : await chromium.launch({ ...launchOptions, channel: "msedge" });
  }

  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") {
      process.stderr.write(`[shader-benchmark] console error: ${message.text()}\n`);
    }
  });
  page.on("pageerror", (error) => {
    process.stderr.write(`[shader-benchmark] page error: ${error.message}\n`);
  });
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: benchmarkChunk.code });
  const report = await page.evaluate(
    async (options) => window.runHookShaderBenchmark(options),
    benchmarkOptions,
  );

  if (
    report.exportSmoke.blobBytes <= 0
    || report.exportSmoke.alpha <= 0
    || report.resolutions.length !== expectedResolutions.length
    || report.resolutions.some((result, index) =>
      result.width !== expectedResolutions[index]?.[0]
      || result.height !== expectedResolutions[index]?.[1]
      || result.pixels !== result.width * result.height
      || !Number.isFinite(result.rehydration.p95Ms)
      || !Number.isFinite(result.adjustment.p95Ms)
      || result.rehydration.samples < 1
      || result.adjustment.samples < 1
    )
  ) {
    throw new Error("Shader benchmark returned incomplete metrics");
  }

  if (enforcePerformanceBudgets) {
    const violations = report.resolutions.flatMap((result) => {
      const messages = [];
      if (result.rehydration.p95Ms > performanceBudgets.rehydrationP95Ms) {
        messages.push(
          `${result.width}x${result.height} rehydration p95 ${result.rehydration.p95Ms.toFixed(2)}ms exceeds ${performanceBudgets.rehydrationP95Ms}ms`,
        );
      }
      if (result.adjustment.p95Ms > performanceBudgets.adjustmentP95Ms) {
        messages.push(
          `${result.width}x${result.height} adjustment p95 ${result.adjustment.p95Ms.toFixed(2)}ms exceeds ${performanceBudgets.adjustmentP95Ms}ms`,
        );
      }
      return messages;
    });
    if (violations.length > 0) {
      throw new Error(`Shader performance budget failed: ${violations.join("; ")}`);
    }
  }

  process.stdout.write(`${JSON.stringify({
    benchmark: "hook-shader-resolution",
    rehydrationScope: "ShaderRenderer compile, source texture upload, first draw, and a 1x1 GPU completion barrier",
    adjustmentScope: "Uniform update, draw, and a benchmark-only 1x1 GPU completion barrier",
    options: benchmarkOptions,
    gate: {
      enforced: enforcePerformanceBudgets,
      budgets: performanceBudgets,
    },
    ...report,
  }, null, 2)}\n`);
} finally {
  await browser?.close();
}
