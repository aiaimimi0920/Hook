import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  countEffectiveLines,
  countPhysicalLines,
  decodeUtf8,
  languageForExtension,
  SUPPORTED_EXTENSIONS,
} from "./effective-code-lines-lexer.mjs";

export const CHECKER_VERSION = 1;

const FIXED_THRESHOLDS = Object.freeze({
  target: 150,
  acceptable: 500,
  soft: 700,
  hard: 1500,
});

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function normalizeRepoPath(value) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`Path must be repository-relative: ${value}`);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Path is not canonical: ${value}`);
  }
  return normalized;
}

function validatePolicy(policy) {
  assert.equal(policy.schemaVersion, 1, "policy schemaVersion must be 1");
  assert.equal(policy.checkerVersion, CHECKER_VERSION, "policy checkerVersion mismatch");
  assert.deepEqual(policy.thresholds, FIXED_THRESHOLDS, "policy thresholds do not match Phase 79");
  assert.match(policy.baselineSourceCommit, /^[0-9a-f]{40}$/, "policy baselineSourceCommit is invalid");
  assert.match(policy.baselineSourceTree, /^[0-9a-f]{40}$/, "policy baselineSourceTree is invalid");
  for (const extension of policy.sourceExtensions) {
    assert.ok(SUPPORTED_EXTENSIONS.includes(extension), `unsupported source extension: ${extension}`);
  }
  for (const entry of [
    ...policy.excludedDirectories,
    ...policy.excludedDirectoryPrefixes,
    ...policy.excludedPaths,
  ]) {
    assert.ok(entry.reason?.trim(), "every exclusion requires a reason");
  }
  for (const entry of policy.excludedPaths) normalizeRepoPath(entry.path);
}

function exclusionIndex(policy) {
  return {
    names: new Set(policy.excludedDirectories.map((entry) => entry.name.toLowerCase())),
    prefixes: policy.excludedDirectoryPrefixes.map((entry) => entry.prefix.toLowerCase()),
    paths: policy.excludedPaths.map((entry) => normalizeRepoPath(entry.path)),
  };
}

function isExcluded(relativePath, directoryName, exclusions) {
  const normalized = relativePath.replaceAll("\\", "/");
  const lowerName = directoryName.toLowerCase();
  if (exclusions.names.has(lowerName)) return true;
  if (exclusions.prefixes.some((prefix) => lowerName.startsWith(prefix))) return true;
  return exclusions.paths.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function rowFromBytes(relativePath, bytes) {
  const extension = path.extname(relativePath).toLowerCase();
  const language = languageForExtension(extension);
  const source = decodeUtf8(bytes, relativePath);
  const canonicalSource = source.replace(/\r\n|\r/g, "\n");
  return {
    path: relativePath,
    language,
    effectiveLines: countEffectiveLines(source, language),
    physicalLines: countPhysicalLines(source),
    sourceSha256: sha256(Buffer.from(canonicalSource, "utf8")),
  };
}

export function scanRepository(root, policy) {
  validatePolicy(policy);
  const resolvedRoot = fs.realpathSync(root);
  const exclusions = exclusionIndex(policy);
  const extensions = new Set(policy.sourceExtensions);
  const rows = [];
  const diagnostics = [];

  function visit(directory, relativeDirectory = "") {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (isExcluded(relativePath, entry.name, exclusions)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        diagnostics.push(`${relativePath}: symbolic links and junctions are not scanned`);
        continue;
      }
      if (entry.isDirectory()) {
        const realDirectory = fs.realpathSync(absolutePath);
        if (realDirectory !== resolvedRoot && !realDirectory.startsWith(`${resolvedRoot}${path.sep}`)) {
          diagnostics.push(`${relativePath}: directory escapes repository root`);
          continue;
        }
        visit(absolutePath, relativePath);
      } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
        rows.push(rowFromBytes(normalizeRepoPath(relativePath), fs.readFileSync(absolutePath)));
      }
    }
  }

  visit(resolvedRoot);
  rows.sort((left, right) => left.path.localeCompare(right.path, "en"));
  return { rows, diagnostics };
}

function runGit(root, args, encoding = "utf8") {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding,
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? decodeUtf8(result.stderr, "git stderr") : result.stderr;
    throw new Error(`git ${args.join(" ")} failed: ${stderr?.trim() || `exit ${result.status}`}`);
  }
  return result.stdout;
}

function revisionRows(root, policy, revision) {
  const exclusions = exclusionIndex(policy);
  const extensions = new Set(policy.sourceExtensions);
  const output = runGit(root, ["ls-tree", "-r", "-z", revision], null);
  const entries = decodeUtf8(output, "git ls-tree").split("\0").filter(Boolean);
  const rows = [];
  for (const entry of entries) {
    const match = /^(\d+)\s+blob\s+[0-9a-f]+\t(.+)$/.exec(entry);
    if (!match) continue;
    const relativePath = normalizeRepoPath(match[2]);
    const parts = relativePath.split("/");
    let excluded = false;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const prefix = parts.slice(0, index + 1).join("/");
      if (isExcluded(prefix, parts[index], exclusions)) {
        excluded = true;
        break;
      }
    }
    if (excluded || !extensions.has(path.extname(relativePath).toLowerCase())) continue;
    if (match[1] === "120000") throw new Error(`${relativePath}: baseline source is a symbolic link`);
    const bytes = runGit(root, ["show", `${revision}:${relativePath}`], null);
    rows.push(rowFromBytes(relativePath, bytes));
  }
  rows.sort((left, right) => left.path.localeCompare(right.path, "en"));
  return rows;
}

function readJson(filePath, label) {
  const bytes = fs.readFileSync(filePath);
  try {
    return JSON.parse(decodeUtf8(bytes, label));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
}

function checkerSha256() {
  return sha256(fs.readFileSync(fileURLToPath(import.meta.url)));
}

function lexerSha256() {
  return sha256(fs.readFileSync(new URL("./effective-code-lines-lexer.mjs", import.meta.url)));
}

export function toolHashes() {
  return { checkerSha256: checkerSha256(), lexerSha256: lexerSha256() };
}

function policySha256(policyPath) {
  return sha256(fs.readFileSync(policyPath));
}

export function createBaseline(root, policy, policyPath) {
  validatePolicy(policy);
  const commit = runGit(root, ["rev-parse", policy.baselineSourceCommit]).trim();
  const tree = runGit(root, ["rev-parse", `${commit}^{tree}`]).trim();
  assert.equal(commit, policy.baselineSourceCommit, "baseline commit did not resolve exactly");
  assert.equal(tree, policy.baselineSourceTree, "baseline tree mismatch");
  const files = revisionRows(root, policy, commit)
    .filter((row) => row.effectiveLines > FIXED_THRESHOLDS.acceptable)
    .map(({ path: filePath, effectiveLines, physicalLines, sourceSha256 }) => ({
      path: filePath,
      effectiveLines,
      physicalLines,
      sourceSha256,
    }));
  return {
    schemaVersion: 1,
    checkerVersion: CHECKER_VERSION,
    sourceCommit: commit,
    sourceTree: tree,
    checkerSha256: checkerSha256(),
    lexerSha256: lexerSha256(),
    policySha256: policySha256(policyPath),
    files,
  };
}

function validateBaseline(root, policy, policyPath, baseline) {
  assert.equal(baseline.schemaVersion, 1, "baseline schemaVersion must be 1");
  assert.equal(baseline.checkerVersion, CHECKER_VERSION, "baseline checkerVersion mismatch");
  assert.equal(baseline.sourceCommit, policy.baselineSourceCommit, "baseline source commit mismatch");
  assert.equal(baseline.sourceTree, policy.baselineSourceTree, "baseline source tree mismatch");
  assert.equal(
    runGit(root, ["rev-parse", `${baseline.sourceCommit}^{tree}`]).trim(),
    baseline.sourceTree,
    "baseline commit no longer resolves to the recorded tree",
  );
  assert.equal(baseline.checkerSha256, checkerSha256(), "checker changed; regenerate and review baseline");
  assert.equal(baseline.lexerSha256, lexerSha256(), "lexer changed; regenerate and review baseline");
  assert.equal(baseline.policySha256, policySha256(policyPath), "policy changed; regenerate and review baseline");
  const seen = new Set();
  for (const entry of baseline.files) {
    const relativePath = normalizeRepoPath(entry.path);
    assert.ok(!seen.has(relativePath), `duplicate baseline path: ${relativePath}`);
    seen.add(relativePath);
    assert.ok(entry.effectiveLines > FIXED_THRESHOLDS.acceptable, `${relativePath}: baseline entry is not oversized`);
    const bytes = runGit(root, ["show", `${baseline.sourceCommit}:${relativePath}`], null);
    const row = rowFromBytes(relativePath, bytes);
    assert.equal(row.effectiveLines, entry.effectiveLines, `${relativePath}: baseline line count mismatch`);
    assert.equal(row.physicalLines, entry.physicalLines, `${relativePath}: baseline physical count mismatch`);
    assert.equal(row.sourceSha256, entry.sourceSha256, `${relativePath}: baseline source hash mismatch`);
  }
}

export function validateExceptions(exceptions, rows, policyPath, today) {
  assert.equal(exceptions.schemaVersion, 1, "exceptions schemaVersion must be 1");
  assert.equal(exceptions.checkerVersion, CHECKER_VERSION, "exceptions checkerVersion mismatch");
  assert.equal(exceptions.checkerSha256, checkerSha256(), "exceptions checker hash mismatch");
  assert.equal(exceptions.lexerSha256, lexerSha256(), "exceptions lexer hash mismatch");
  assert.equal(exceptions.policySha256, policySha256(policyPath), "exceptions policy hash mismatch");
  const byPath = new Map(rows.map((row) => [row.path, row]));
  const valid = new Map();
  for (const entry of exceptions.exceptions) {
    const relativePath = normalizeRepoPath(entry.path);
    assert.ok(!valid.has(relativePath), `duplicate exception path: ${relativePath}`);
    const row = byPath.get(relativePath);
    assert.ok(row, `${relativePath}: exception source does not exist`);
    assert.ok(row.effectiveLines > FIXED_THRESHOLDS.acceptable, `${relativePath}: exception is no longer needed`);
    assert.ok(row.effectiveLines <= FIXED_THRESHOLDS.soft, `${relativePath}: exceptions cannot exceed 700 lines`);
    assert.equal(entry.effectiveLines, row.effectiveLines, `${relativePath}: exception line count is stale`);
    assert.equal(entry.sourceSha256, row.sourceSha256, `${relativePath}: exception source hash is stale`);
    for (const field of ["responsibility", "reason", "owner", "approvedBy"]) {
      assert.ok(entry[field]?.trim(), `${relativePath}: exception ${field} is required`);
    }
    assert.notEqual(entry.owner, entry.approvedBy, `${relativePath}: exception requires an independent reviewer`);
    assert.match(entry.reviewBy, /^\d{4}-\d{2}-\d{2}$/, `${relativePath}: exception reviewBy is invalid`);
    assert.ok(entry.reviewBy >= today, `${relativePath}: exception expired on ${entry.reviewBy}`);
    assert.ok(Array.isArray(entry.tests) && entry.tests.length > 0, `${relativePath}: exception tests are required`);
    valid.set(relativePath, entry);
  }
  return valid;
}

export function evaluateRows(rows, baseline, validExceptions, mode) {
  const baselineByPath = new Map(baseline.files.map((entry) => [entry.path, entry]));
  const violations = [];
  const warnings = [];
  for (const row of rows) {
    const old = baselineByPath.get(row.path);
    const unchanged = old
      && old.effectiveLines === row.effectiveLines
      && old.sourceSha256 === row.sourceSha256;
    if (row.effectiveLines > FIXED_THRESHOLDS.soft) {
      if (mode === "strict") {
        violations.push(`${row.path}: ${row.effectiveLines} effective lines exceeds strict limit 700`);
      } else if (!unchanged) {
        violations.push(`${row.path}: oversized baseline file changed before reaching 700 lines`);
      } else {
        const severity = row.effectiveLines > FIXED_THRESHOLDS.hard ? "hard-cap" : "mandatory";
        warnings.push(`${row.path}: unchanged ${severity} migration debt (${row.effectiveLines})`);
      }
    } else if (row.effectiveLines > FIXED_THRESHOLDS.acceptable) {
      if (!unchanged && !validExceptions.has(row.path)) {
        violations.push(`${row.path}: ${row.effectiveLines} lines requires a current 501-700 exception`);
      } else if (unchanged) {
        warnings.push(`${row.path}: unchanged 501-700 migration debt (${row.effectiveLines})`);
      }
    }
  }
  return { violations, warnings };
}

function parseArguments(argv) {
  const options = { mode: "ratchet", writeBaseline: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write-baseline") options.writeBaseline = true;
    else if (["--mode", "--policy", "--baseline", "--exceptions", "--json", "--root"].includes(argument)) {
      options[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!["ratchet", "strict", "report"].includes(options.mode)) throw new Error(`Invalid mode: ${options.mode}`);
  return options;
}

function resolveFromRoot(root, value, fallback) {
  return path.resolve(root, value || fallback);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function summarizeRows(rows) {
  return {
    scanned: rows.length,
    hard: rows.filter((row) => row.effectiveLines > FIXED_THRESHOLDS.hard).length,
    mandatory: rows.filter((row) => row.effectiveLines > FIXED_THRESHOLDS.soft && row.effectiveLines <= FIXED_THRESHOLDS.hard).length,
    soft: rows.filter((row) => row.effectiveLines > FIXED_THRESHOLDS.acceptable && row.effectiveLines <= FIXED_THRESHOLDS.soft).length,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const root = fs.realpathSync(options.root || path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const policyPath = resolveFromRoot(root, options.policy, "scripts/effective-code-lines-policy.json");
  const baselinePath = resolveFromRoot(root, options.baseline, "scripts/effective-code-lines-baseline.json");
  const exceptionsPath = resolveFromRoot(root, options.exceptions, "scripts/effective-code-lines-exceptions.json");
  const policy = readJson(policyPath, "effective-line policy");
  validatePolicy(policy);

  if (options.writeBaseline) {
    const baseline = createBaseline(root, policy, policyPath);
    writeJson(baselinePath, baseline);
    console.log(`Wrote ${baseline.files.length} baseline entries to ${baselinePath}`);
    return 0;
  }

  const baseline = readJson(baselinePath, "effective-line baseline");
  validateBaseline(root, policy, policyPath, baseline);
  const { rows, diagnostics } = scanRepository(root, policy);
  const today = new Date().toISOString().slice(0, 10);
  const exceptions = readJson(exceptionsPath, "effective-line exceptions");
  const validExceptions = validateExceptions(exceptions, rows, policyPath, today);
  const evaluation = evaluateRows(rows, baseline, validExceptions, options.mode);
  const violations = [...diagnostics, ...evaluation.violations];
  const summary = summarizeRows(rows);
  const report = {
    schemaVersion: 1,
    checkerVersion: CHECKER_VERSION,
    mode: options.mode,
    thresholds: FIXED_THRESHOLDS,
    summary,
    violations,
    warnings: evaluation.warnings,
    files: rows.filter((row) => row.effectiveLines > FIXED_THRESHOLDS.acceptable)
      .sort((left, right) => right.effectiveLines - left.effectiveLines || left.path.localeCompare(right.path, "en")),
  };
  if (options.json) writeJson(resolveFromRoot(root, options.json, options.json), report);
  console.log(`Effective lines: ${summary.scanned} files; >1500=${summary.hard}, 701-1500=${summary.mandatory}, 501-700=${summary.soft}`);
  for (const violation of violations) console.error(`ERROR: ${violation}`);
  if (options.mode !== "report" && violations.length > 0) return 1;
  return 0;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    console.error(`Effective-line checker failed: ${error.stack || error.message}`);
    process.exitCode = 2;
  });
}
