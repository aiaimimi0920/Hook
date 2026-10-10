const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { npmInventory, lockInventory, verifyInventory, purl } = require("../release/sbom-inventory.cjs");

test("scoped npm purls preserve the namespace separator", () => {
  assert.equal(purl({ ecosystem: "npm", name: "@scope/pkg", version: "1.2.3" }), "pkg:npm/%40scope/pkg@1.2.3");
});

test("lock v3 derives direct, nested, scoped and alias package identities", () => {
  const packages = { "": { name: "hook", version: "1" },
    "node_modules/solid-js": { version: "1.9.0" },
    "node_modules/a/node_modules/@scope/b": { version: "2" },
    "node_modules/alias": { name: "real-package", version: "3" },
    "node_modules/workspace": { link: true, resolved: "packages/workspace" },
    "packages/workspace": { name: "workspace", version: "4" } };
  assert.deepEqual(npmInventory({ lockfileVersion: 3, packages }).map(p => p.name), ["solid-js", "@scope/b", "real-package", "workspace"]);
  assert.throws(() => npmInventory({ lockfileVersion: 3, packages: { "packages/unresolved": { version: "1" } } }));
});
test("both SBOM inventories must exactly cover authoritative lock identities", () => {
  const expected = lockInventory(path.resolve(__dirname, "../.."));
  assert.ok(expected.some(p => p.ecosystem === "npm" && p.name === "solid-js"));
  assert.ok(expected.filter(p => p.ecosystem === "npm").length > 100);
  const cyclone = { components: expected.map(p => ({ name: p.name, version: p.version, purl: p.purl })) };
  const spdx = { packages: expected.map(p => ({ name: p.name, versionInfo: p.version, externalRefs: [{ referenceType: "purl", referenceLocator: p.purl }] })) };
  verifyInventory(expected, cyclone, spdx);
  assert.throws(() => verifyInventory(expected, { components: cyclone.components.slice(1) }, spdx));
  assert.throws(() => verifyInventory(expected, cyclone, { packages: spdx.packages.slice(1) }));
  const duplicate = structuredClone(cyclone);
  duplicate.components[1] = duplicate.components[0];
  assert.throws(() => verifyInventory(expected, duplicate, spdx));
  const altered = structuredClone(spdx);
  altered.packages[0].versionInfo = "forged";
  assert.throws(() => verifyInventory(expected, cyclone, altered));
});
