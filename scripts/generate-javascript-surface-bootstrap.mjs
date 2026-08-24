import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const sourceRoot = join(scriptDir, "javascript-surface-bootstrap");
const outputPath = join(repoRoot, "public", "javascript-surface-bootstrap.js");
const maxFragmentBytes = 256 * 1024;

export const fragmentNames = Object.freeze([
  "00-runtime-state.fragment.js",
  "10-trusted-host-input.fragment.js",
  "20-sandbox-runtime.fragment.js",
  "30-synthetic-pointer.fragment.js",
  "40-lifecycle.fragment.js",
  "50-host-protocol.fragment.js",
]);

export const fragmentPaths = Object.freeze(
  fragmentNames.map((name) => join(sourceRoot, name)),
);

const readFragment = (path) => {
  const bytes = readFileSync(path);
  if (bytes.length > maxFragmentBytes) {
    throw new Error(`JavaScript Surface bootstrap fragment exceeds ${maxFragmentBytes} bytes: ${path}`);
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error(`JavaScript Surface bootstrap fragment must be UTF-8 without BOM: ${path}`);
  }
  return bytes.toString("utf8").replace(/\r\n/g, "\n").replace(/\n+$/u, "");
};

export const buildBootstrapSource = () => `${fragmentPaths.map(readFragment).join("\n\n")}\n`;

export const checkBootstrapSource = () => {
  if (!existsSync(outputPath)) return false;
  return readFileSync(outputPath, "utf8").replace(/\r\n/g, "\n") === buildBootstrapSource();
};

const writeBootstrapSource = () => {
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  try {
    writeFileSync(temporaryPath, buildBootstrapSource(), { encoding: "utf8", flag: "wx" });
    renameSync(temporaryPath, outputPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
};

const run = () => {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check")) {
    throw new Error(`Unknown JavaScript Surface bootstrap generator argument: ${args.join(" ")}`);
  }
  if (args.includes("--check")) {
    if (!checkBootstrapSource()) {
      throw new Error("public/javascript-surface-bootstrap.js is stale; run npm run generate:surface-bootstrap");
    }
    return;
  }
  writeBootstrapSource();
};

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) run();
