# Writes the CDP probe consumed by the native Tauri smoke.

@'
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";

const require = createRequire(`${process.cwd()}\\package.json`);
const { chromium } = require("playwright");

const cdpUrl = process.env.HOOK_TEA_TAURI_CDP_URL;
const resultPath = process.env.HOOK_TEA_TAURI_RESULT_PATH;
const timeoutMs = Number(process.env.HOOK_TEA_TAURI_TIMEOUT_MS || "60000");

if (!cdpUrl || !resultPath) {
  throw new Error("HOOK_TEA_TAURI_CDP_URL and HOOK_TEA_TAURI_RESULT_PATH are required");
}

const consoleMessages = [];
const pageErrors = [];
const pageStates = [];
const seenPages = new Set();

const writeResult = async (result) => {
  await writeFile(resultPath, JSON.stringify(result, null, 2), "utf8");
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const trackPage = (page) => {
  if (seenPages.has(page)) return;
  seenPages.add(page);
  page.on("console", (message) => {
    consoleMessages.push({ type: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error instanceof Error ? error.message : String(error));
  });
};

const attachedLocatorOnAnyPage = async (browser, selector, timeout) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    for (const page of pages) {
      if (page.isClosed()) continue;
      trackPage(page);
      pageStates.push({
        at: new Date().toISOString(),
        url: page.url(),
        title: await page.title().catch(() => ""),
      });
      try {
        const locator = page.locator(selector);
        await locator.waitFor({ state: "attached", timeout: 500 });
        return { page, locator };
      } catch {
        // Keep polling pages until the real WebView has mounted the Hook UI.
      }
    }
    await delay(300);
  }
  throw new Error(`Timed out waiting for attached selector ${selector}`);
};

let browser = null;
try {
  browser = await chromium.connectOverCDP(cdpUrl);
  for (const context of browser.contexts()) {
    context.on("page", trackPage);
    for (const page of context.pages()) {
      trackPage(page);
    }
  }

  const { page, locator: button } = await attachedLocatorOnAnyPage(
    browser,
    '[data-testid="tea-ticket-button"]',
    timeoutMs,
  );
  const output = page.locator('[data-testid="tea-ticket-output"]');
  const nativeTauriRuntime = await page.evaluate(() => Boolean(window.__TAURI_INTERNALS__));
  if (!nativeTauriRuntime) {
    throw new Error("Hook WebView did not expose the native Tauri runtime");
  }

  await button.evaluate((element) => element.click());
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-testid="tea-ticket-output"]')?.textContent || "";
    return /[0-9a-f-]{36}/i.test(text);
  }, { timeout: timeoutMs });

  const outputText = await output.evaluate((element) => element.textContent || "");
  const ticketId = outputText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || null;
  if (!ticketId) {
    throw new Error(`Could not extract ticket id from output: ${outputText}`);
  }

  await writeResult({
    status: "passed",
    ticketId,
    outputText,
    native_tauri_runtime: nativeTauriRuntime,
    frontendTicketRecorded: outputText.includes(ticketId),
    pageUrl: page.url(),
    pageTitle: await page.title().catch(() => ""),
    pageStates,
    consoleMessages,
    pageErrors,
  });
} catch (error) {
  await writeResult({
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
    pageStates,
    consoleMessages,
    pageErrors,
  });
  throw error;
} finally {
  if (browser) {
    await browser.close().catch(() => {});
  }
}
'@ | Set-Content -LiteralPath $uiSmokeScript -Encoding UTF8
