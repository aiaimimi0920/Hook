const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function assertTag(tag) {
  if (!/^V\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`Release tag must match Vx.y.z: ${tag}`);
  }
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function collectExpectedAssets(packageDirectory, tag) {
  assertTag(tag);
  const root = path.resolve(packageDirectory);
  const zipName = `hook-windows-x64-${tag}.zip`;
  const files = [
    path.join(root, "packages", zipName),
    path.join(root, "packages", `${zipName}.sha256`),
  ];
  const records = files.map((filePath) => {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Expected Hook release asset is missing: ${filePath}`);
    }
    return { name: path.basename(filePath), path: filePath, bytes: fs.statSync(filePath).size };
  });
  if (new Set(records.map((record) => record.name)).size !== records.length) {
    throw new Error("Hook release asset names must be unique.");
  }
  return records;
}

async function compareAssets(expected, actual) {
  const actualByName = new Map();
  for (const asset of actual) {
    if (actualByName.has(asset.name)) throw new Error(`Duplicate GitHub release asset: ${asset.name}`);
    actualByName.set(asset.name, asset);
  }
  const expectedNames = new Set(expected.map((asset) => asset.name));
  const missing = expected.filter((asset) => !actualByName.has(asset.name)).map((asset) => asset.name);
  const unexpected = actual.filter((asset) => !expectedNames.has(asset.name)).map((asset) => asset.name);
  if (missing.length || unexpected.length) {
    throw new Error(`GitHub draft asset set mismatch. missing=${missing.join(",") || "none"} unexpected=${unexpected.join(",") || "none"}`);
  }
  for (const record of expected) {
    const asset = actualByName.get(record.name);
    if (Number(asset.size) !== record.bytes) throw new Error(`GitHub asset size mismatch: ${record.name}`);
    if (!asset.digest) throw new Error(`GitHub asset digest is missing: ${record.name}`);
    const digest = await sha256File(record.path);
    if (asset.digest !== `sha256:${digest}`) throw new Error(`GitHub asset digest mismatch: ${record.name}`);
  }
}

async function assertReleaseAbsent({ github, owner, repo, tag }) {
  assertTag(tag);
  const releases = await github.paginate(github.rest.repos.listReleases, { owner, repo, per_page: 100 });
  const existing = releases.find((release) => release.tag_name === tag);
  if (existing) {
    throw new Error(`Hook release ${tag} already exists as ${existing.draft ? "draft" : "published"}: ${existing.html_url}`);
  }
}

async function publishVerifiedDraft({ github, owner, repo, releaseId, tag, packageDirectory }) {
  assertTag(tag);
  const id = Number(releaseId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Draft release ID is invalid: ${releaseId}`);
  const { data: release } = await github.rest.repos.getRelease({ owner, repo, release_id: id });
  if (!release.draft || release.tag_name !== tag) throw new Error(`Release ${id} is not the expected Hook draft for ${tag}.`);
  const actual = await github.paginate(github.rest.repos.listReleaseAssets, { owner, repo, release_id: id, per_page: 100 });
  await compareAssets(collectExpectedAssets(packageDirectory, tag), actual);
  return github.rest.repos.updateRelease({ owner, repo, release_id: id, draft: false, make_latest: "legacy" });
}

async function deleteFailedDraft({ github, owner, repo, releaseId, tag }) {
  const id = Number(releaseId);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const { data: release } = await github.rest.repos.getRelease({ owner, repo, release_id: id });
  if (!release.draft || release.tag_name !== tag) return false;
  await github.rest.repos.deleteRelease({ owner, repo, release_id: id });
  return true;
}

module.exports = { assertReleaseAbsent, collectExpectedAssets, compareAssets, deleteFailedDraft, publishVerifiedDraft };
