import { build } from "esbuild";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join, relative, isAbsolute } from "node:path";

const repo = resolve(process.cwd());
const output = resolve(process.argv[2]);
const within = relative(join(repo, "artifacts"), output);
assert(within && !within.startsWith("..") && !isAbsolute(within), "Evidence must stay in Hook artifacts");
await mkdir(output);
// Keep the real registry/parser/when engine; replace only command side effects and selected-unit context.
const bundle = await build({
    absWorkingDir: repo, bundle: true, write: false, format: "iife", platform: "browser", minify: true,
    stdin: { resolveDir: repo, loader: "ts", contents: `
        import { ExtensionShortcutRegistry } from './src/services/extensionShortcutRegistry';
        import { parseContributionSnapshot } from './src/services/extensionProtocol';
        const registry = new ExtensionShortcutRegistry();
        window.__shortcutProbe = { calls: [], targets: [], registry };
        const rejected = registry.applySnapshot(parseContributionSnapshot({
            protocol: 'loom.extension.v1', apiVersion: '1.0', generation: 1,
            plugins: [{ id: 'neuro.official/ocr', version: '1.3.1', packageDigest: 'a'.repeat(64),
                trustStatus: 'trusted', permissionGrantDigest: 'b'.repeat(64), scopeId: 'ocr-test' }],
            contributions: { shortcuts: [
                { id: 'ocr-recognize', pluginId: 'neuro.official/ocr', scopeId: 'ocr-test',
                    commandId: 'neuro.official/ocr.recognize-selected-unit', when: "unit.kind == 'sticker' && unit.hasImage",
                    payload: { schema: null, payload: { keys: 'ctrl+4', global: true } } },
                { id: 'ocr-toggle', pluginId: 'neuro.official/ocr', scopeId: 'ocr-test',
                    commandId: 'neuro.official/ocr.toggle-overlay', when: "unit.kind == 'sticker'",
                    payload: { schema: null, payload: { keys: 'alt+4' } } }
            ], commands: [], menus: [], settings: [], dataTypes: [], renderers: [], unitOverlays: [],
                backgroundTasks: [], resourceProviders: [], diagnostics: [], eventSubscriptions: [] }
        }));
        if (rejected.length) throw new Error('Rejected fixture shortcuts');
        window.addEventListener('keydown', (event) => {
            window.__shortcutProbe.targets.push(event.target === window ? 'window' : event.target.nodeName);
            registry.handleKeyDown(event);
        }, true);
    ` },
    plugins: [{ name: "shortcut-side-effects", setup(builder) {
        builder.onResolve({ filter: /\/extension(CommandRouter|Context)$/ }, (args) => ({ path: args.path, namespace: "shortcut-fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "shortcut-fixture" }, (args) => ({ loader: "js", contents:
            args.path.endsWith("extensionContext")
                ? "export const currentExtensionTarget = () => ({ unitId: 'fixture-unit', revision: 0 }); export const currentExtensionWhenContext = () => ({ unit: { kind: 'sticker', hasImage: true } });"
                : "export const extensionCommandRouter = { execute: async (id) => { window.__shortcutProbe.calls.push(id); } };" }));
    } }],
});
const browser = await chromium.launch({ headless: true });
const result: Record<string, unknown> = { passed: false };
const errors: string[] = [];
try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setContent("<input id='editor'><div data-hook-global-shortcuts='ignore'><span id='ignored'>live</span><svg id='ignored-svg'></svg></div>");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const observed = await page.evaluate(() => {
        const probe = (window as unknown as { __shortcutProbe: {
            calls: string[]; targets: string[]; registry: { applySnapshot(value: null): void };
        } }).__shortcutProbe;
        const key = (target: EventTarget, value = "4", alt = false) => {
            const event = new KeyboardEvent("keydown", { key: value, ctrlKey: !alt, altKey: alt, bubbles: true, cancelable: true });
            target.dispatchEvent(event);
            return event.defaultPrevented;
        };
        const consumed = [key(window), key(document), key(document.body)];
        const ignored = [key(document.querySelector("input")!), key(document.getElementById("ignored")!),
            key(document.getElementById("ignored-svg")!), key(window, "2")];
        const alt4 = key(window, "4", true);
        probe.registry.applySnapshot(null);
        const afterClear = key(window);
        return { calls: probe.calls, targets: probe.targets, consumed, ignored, alt4, afterClear };
    });
    assert.deepEqual(observed.consumed, [true, true, true]);
    assert.deepEqual(observed.ignored, [false, false, false, false]);
    assert.equal(observed.alt4, true);
    assert.equal(observed.afterClear, false);
    assert.equal(observed.targets[0], "window");
    assert.deepEqual(observed.calls, [...Array<string>(3).fill("neuro.official/ocr.recognize-selected-unit"), "neuro.official/ocr.toggle-overlay"]);
    assert.deepEqual(errors, []);
    Object.assign(result, { passed: true, engine: await browser.version(), ...observed });
} catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
} finally {
    await browser.close();
    await writeFile(join(output, "summary.json"), JSON.stringify({ ...result, errors }, null, 2));
    console.log(JSON.stringify({ ...result, errors }));
}
