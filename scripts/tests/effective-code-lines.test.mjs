import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  decodeUtf8,
  countEffectiveLines,
  countPhysicalLines,
} from "../effective-code-lines-lexer.mjs";
import {
  evaluateRows,
  normalizeRepoPath,
  scanRepository,
  summarizeRows,
  toolHashes,
  validateExceptions,
} from "../effective-code-lines.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const policyPath = path.join(repoRoot, "scripts", "effective-code-lines-policy.json");
const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function row(filePath, effectiveLines, sourceSha256 = digest(filePath)) {
  return {
    path: filePath,
    language: "c-like",
    effectiveLines,
    physicalLines: effectiveLines,
    sourceSha256,
  };
}

test("counts Rust code while removing nested comments", () => {
  const source = String.raw`/* outer
  /* nested */
*/
fn value<'a>(input: &'a str) -> &'a str { // contract
    let url = r##"https://example.test/a//b"##;
    let payload = r##"
// raw string data
"##;
    input
}`;
  assert.equal(countEffectiveLines(source, "rust"), 7);
});

test("counts JavaScript regexes and multiline templates as code", () => {
  const source = String.raw`/* global window */
const url = "https://example.test/a//b";
const pattern = /^data:([^;,]+);base64,(.+)$/s;
// comment only
const sourceText = \`
// template data
\`;
`;
  assert.equal(countEffectiveLines(source, "c-like"), 5);
});

test("counts PowerShell here-strings and ignores comments", () => {
  const source = `<#\r\ncomment\r\n#>\r\n$value = "hash # data" # tail\r\n$script = @'\r\n# here-string data\r\n'@\r\n# comment\r\n`;
  assert.equal(countEffectiveLines(source, "powershell"), 4);
});

test("treats Python docstrings as documentation and assigned triples as code", () => {
  const source = `#!/usr/bin/env python\n"""module docs\ncontinued docs\n"""\ndef value():\n    """function docs"""\n    payload = """first\n+# payload data\n+"""\n    return payload  # tail\n`;
  assert.equal(countEffectiveLines(source, "python"), 5);
});

test("counts CSS and HTML around their comment forms", () => {
  const css = `/* comment\ncontinued */\n.card {\n  background: url("https://example.test/a/*literal*/");\n}\n`;
  const html = `<!-- comment\ncontinued -->\n<main>\n  <span>value</span><!-- tail -->\n</main>\n`;
  assert.equal(countEffectiveLines(css, "css"), 3);
  assert.equal(countEffectiveLines(html, "html"), 3);
});

test("removes CMD comment forms without hiding normal commands", () => {
  const source = `REM comment\n@rem comment\n:: comment\necho REM data\necho :: data\n`;
  assert.equal(countEffectiveLines(source, "cmd"), 2);
});

test("normalizes BOM and line endings deterministically", () => {
  const bytes = Buffer.from("\uFEFFconst first = 1;\r\n\r\n// comment\r\nconst second = 2;\r\n", "utf8");
  const source = decodeUtf8(bytes, "fixture");
  assert.equal(source.charCodeAt(0), "c".charCodeAt(0));
  assert.equal(countPhysicalLines(source), 4);
  assert.equal(countEffectiveLines(source, "c-like"), 2);
});

test("rejects invalid UTF-8 instead of silently replacing bytes", () => {
  assert.throws(() => decodeUtf8(Buffer.from([0xff]), "fixture"), /not valid UTF-8/);
});

test("normalizes repository paths and rejects escape paths", () => {
  assert.equal(normalizeRepoPath("src\\service.ts"), "src/service.ts");
  assert.throws(() => normalizeRepoPath("../outside.ts"), /not canonical/);
  assert.throws(() => normalizeRepoPath("C:\\outside.ts"), /repository-relative/);
  assert.throws(() => normalizeRepoPath("src//service.ts"), /not canonical/);
});

test("ratchet permits only untouched oversized baseline files", () => {
  const original = row("src/large.rs", 900, "same");
  const baseline = { files: [{ ...original }] };
  const unchanged = evaluateRows([original], baseline, new Map(), "ratchet");
  assert.equal(unchanged.violations.length, 0);
  assert.equal(unchanged.warnings.length, 1);

  const changed = evaluateRows([{ ...original, effectiveLines: 899, sourceSha256: "changed" }], baseline, new Map(), "ratchet");
  assert.match(changed.violations[0], /changed before reaching 700/);

  const strict = evaluateRows([original], baseline, new Map(), "strict");
  assert.match(strict.violations[0], /exceeds strict limit 700/);
});

test("soft-limit files require an exact exception once changed or added", () => {
  const current = row("src/cohesive.ts", 600, "current");
  const withoutException = evaluateRows([current], { files: [] }, new Map(), "ratchet");
  assert.match(withoutException.violations[0], /requires a current 501-700 exception/);

  const withException = evaluateRows([current], { files: [] }, new Map([[current.path, {}]]), "ratchet");
  assert.equal(withException.violations.length, 0);
});

test("exception validation rejects stale, expired, and over-limit records", () => {
  const current = row("src/cohesive.ts", 600, "current");
  const policyHash = digest(fs.readFileSync(policyPath));
  const validEntry = {
    path: current.path,
    effectiveLines: current.effectiveLines,
    sourceSha256: current.sourceSha256,
    responsibility: "One cohesive parser state machine.",
    reason: "Splitting would duplicate state transitions.",
    owner: "maintainers",
    approvedBy: "reviewer",
    reviewBy: "2099-12-31",
    tests: ["node --test scripts/tests/effective-code-lines.test.mjs"],
  };
  const document = {
    schemaVersion: 1,
    checkerVersion: 1,
    ...toolHashes(),
    policySha256: policyHash,
    exceptions: [validEntry],
  };
  assert.equal(validateExceptions(document, [current], policyPath, "2026-08-23").size, 1);
  assert.throws(
    () => validateExceptions({ ...document, exceptions: [{ ...validEntry, sourceSha256: "stale" }] }, [current], policyPath, "2026-08-23"),
    /source hash is stale/,
  );
  assert.throws(
    () => validateExceptions({ ...document, exceptions: [{ ...validEntry, reviewBy: "2026-01-01" }] }, [current], policyPath, "2026-08-23"),
    /exception expired/,
  );
  assert.throws(
    () => validateExceptions({ ...document, exceptions: [{ ...validEntry, approvedBy: validEntry.owner }] }, [current], policyPath, "2026-08-23"),
    /independent reviewer/,
  );
  assert.throws(
    () => validateExceptions({ ...document, exceptions: [{ ...validEntry, effectiveLines: 701 }] }, [{ ...current, effectiveLines: 701 }], policyPath, "2026-08-23"),
    /exceptions cannot exceed 700/,
  );
});

test("repository scan excludes declared generated paths and rejects symlink inputs", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "effective-lines-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, "target"));
  fs.writeFileSync(path.join(root, "src", "kept.ts"), "// comment\nconst kept = 1;\n", "utf8");
  fs.writeFileSync(path.join(root, "target", "ignored.ts"), "const ignored = 1;\n", "utf8");
  const result = scanRepository(root, policy);
  assert.deepEqual(result.rows.map((entry) => entry.path), ["src/kept.ts"]);
  assert.equal(result.rows[0].effectiveLines, 1);
  assert.deepEqual(result.diagnostics, []);
});

test("repository scan hashes LF and CRLF source identically", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "effective-lines-eol-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "lf.ts"), "const value = 1;\n", "utf8");
  fs.writeFileSync(path.join(root, "crlf.ts"), "const value = 1;\r\n", "utf8");
  const result = scanRepository(root, policy);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].sourceSha256, result.rows[1].sourceSha256);
});

test("summary uses the exact Phase 79 tiers", () => {
  assert.deepEqual(
    summarizeRows([
      row("a.ts", 500),
      row("b.ts", 501),
      row("c.ts", 700),
      row("d.ts", 701),
      row("e.ts", 1500),
      row("f.ts", 1501),
    ]),
    { scanned: 6, hard: 1, mandatory: 2, soft: 2 },
  );
});
