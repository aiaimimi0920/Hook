import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Materialize deliberately unsafe test inputs outside the application checkout.
// Do not add production path exclusions or filter uploaded SARIF results.
const root = process.cwd();
const pack = path.join(root, ".github/codeql");
const upstream = JSON.parse(fs.readFileSync(path.join(pack, "upstream.json"), "utf8"));
const codeql = process.argv[2] || "codeql";
const options = [
    process.env.CODEQL_ADDITIONAL_PACKS && `--additional-packs=${process.env.CODEQL_ADDITIONAL_PACKS}`,
    process.env.CODEQL_COMMON_CACHES && `--common-caches=${process.env.CODEQL_COMMON_CACHES}`,
].filter(Boolean);
const run = (...args) => execFileSync(codeql, [...args, ...(args[0] === "version" ? [] : options)], {
    encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
});
const lines = (value) => value.trim().split(/\r?\n/).filter(Boolean).sort();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const version = JSON.parse(run("version", "--format=json"));
assert.equal(version.version, upstream.cliVersion, "Review the pinned CodeQL toolchain before upgrading");
const stockPath = run("resolve", "queries",
    `codeql/javascript-queries@${upstream.queryPackVersion}:Security/CWE-020/MissingOriginCheck.ql`).trim();
const stock = fs.readFileSync(stockPath);
const versionOfPack = (file) => fs.readFileSync(file, "utf8").match(/^version:\s*["']?(\d+\.\d+\.\d+)["']?\s*$/m)?.[1];
assert.equal(versionOfPack(path.resolve(path.dirname(stockPath), "../..", "qlpack.yml")), upstream.queryPackVersion);
const library = JSON.parse(run("resolve", "library-path", `--query=${path.join(pack, "MissingOriginCheck.ql")}`, "--format=json"));
const libraryVersion = versionOfPack(path.join(path.dirname(library.dbscheme), "qlpack.yml"));
assert.equal(libraryVersion, upstream.libraryPackVersion, "Unexpected JavaScript library pack version");
assert.equal(sha256(stock), upstream.querySha256, "Upstream rule drift: review and update, never fall back silently");
const stockSuite = lines(run("resolve", "queries",
    `codeql/javascript-queries@${upstream.queryPackVersion}:codeql-suites/javascript-security-extended.qls`));
const customSuite = lines(run("resolve", "queries", path.join(pack, "security-extended.qls")));
const customPath = path.join(pack, "MissingOriginCheck.ql");
assert.deepEqual(stockSuite.filter((query) => !customSuite.includes(query)), [stockPath]);
assert.deepEqual(customSuite.filter((query) => !stockSuite.includes(query)), [customPath]);
assert.equal(stockSuite.length, customSuite.length, "Security-extended coverage must be preserved");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "hook-codeql-worker-"));
const evidence = { cliVersion: version.version, libraryPackVersion: libraryVersion, sourceCommit: upstream.sourceCommit,
    stockQuerySha256: sha256(stock), stockQueryCount: stockSuite.length,
    customQueryCount: customSuite.length, preservedOtherQueries: stockSuite.length - 1,
    testsPassed: false };
const output = path.join(root, "artifacts/codeql-worker-model");
fs.mkdirSync(output, { recursive: true });
try {
    fs.copyFileSync(path.join(pack, "qlpack.yml"), path.join(temporary, "qlpack.yml"));
    fs.copyFileSync(customPath, path.join(temporary, "MissingOriginCheck.ql"));
    fs.writeFileSync(path.join(temporary, "StockMissingOriginCheck.ql"), stock);
    for (const group of fs.readdirSync(path.join(pack, "fixtures"))) {
        const source = path.join(pack, "fixtures", group);
        const destination = path.join(temporary, group);
        fs.mkdirSync(destination);
        for (const name of fs.readdirSync(source)) {
            fs.copyFileSync(path.join(source, name), path.join(destination, name.replace(/\.fixture$/, "")));
        }
    }
    const groups = fs.readdirSync(path.join(pack, "fixtures")).map((group) => path.join(temporary, group));
    const log = run("test", "run", ...groups, "--threads=1", "--ram=2800");
    fs.writeFileSync(path.join(output, "query-tests.log"), log);
    evidence.testsPassed = true;
    console.log(log);
} catch (error) {
    fs.writeFileSync(path.join(output, "query-tests.log"), `${error.stdout || ""}\n${error.stderr || ""}\n${error}`);
    throw error;
} finally {
    fs.writeFileSync(path.join(output, "coverage.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    fs.rmSync(temporary, { recursive: true, force: true });
}
