import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

import {
  buildBootstrapSource,
  checkBootstrapSource,
  fragmentPaths,
} from "../generate-javascript-surface-bootstrap.mjs";

const outputPath = resolve("public/javascript-surface-bootstrap.js");

test("JavaScript Surface bootstrap is a deterministic generated classic script", () => {
  assert.equal(checkBootstrapSource(), true);
  assert.equal(readFileSync(outputPath, "utf8"), buildBootstrapSource());
  for (const path of fragmentPaths) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.split(/\r?\n/u).length <= 500, `${path} exceeds 500 physical lines`);
    assert.notEqual(source.charCodeAt(0), 0xfeff, `${path} has a UTF-8 BOM`);
  }
  const syntax = spawnSync(process.execPath, ["--check", outputPath], {
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  assert.equal(syntax.error, undefined);
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);
});
