import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const hookRoot = process.cwd();
const readmeEn = readFileSync(resolve(hookRoot, "README.md"), "utf8");
const readmeZh = readFileSync(resolve(hookRoot, "README.zh-CN.md"), "utf8");
const docsIndex = readFileSync(resolve(hookRoot, "docs/README.md"), "utf8");
const codeSigningPolicyPath = resolve(hookRoot, "docs/CODE_SIGNING_POLICY.md");
const privacyPolicyPath = resolve(hookRoot, "docs/PRIVACY_POLICY.md");
const maintainerGuidePath = resolve(hookRoot, "docs/MAINTAINER_SIGNING_GUIDE.md");
const releaseStrategyPath = resolve(hookRoot, "docs/RELEASE_STRATEGY.md");
const signPathChecklistPath = resolve(hookRoot, "docs/SIGNPATH_APPLICATION_CHECKLIST.md");
const signPathDraftPath = resolve(hookRoot, "docs/SIGNPATH_APPLICATION_DRAFT.md");
const distributionNotesPath = resolve(hookRoot, "UIACCESS_DISTRIBUTION.md");

const codeSigningPolicy = readFileSync(codeSigningPolicyPath, "utf8");
const privacyPolicy = readFileSync(privacyPolicyPath, "utf8");
const maintainerGuide = readFileSync(maintainerGuidePath, "utf8");
const releaseStrategy = readFileSync(releaseStrategyPath, "utf8");
const signPathChecklist = readFileSync(signPathChecklistPath, "utf8");
const signPathDraft = readFileSync(signPathDraftPath, "utf8");
const distributionNotes = readFileSync(distributionNotesPath, "utf8");

describe("Hook signing docs contract", () => {
  it("ships public signing/privacy docs, a maintainer signing guide, a release strategy doc, a SignPath application checklist, and a submission draft", () => {
    expect(existsSync(codeSigningPolicyPath)).toBe(true);
    expect(existsSync(privacyPolicyPath)).toBe(true);
    expect(existsSync(maintainerGuidePath)).toBe(true);
    expect(existsSync(releaseStrategyPath)).toBe(true);
    expect(existsSync(signPathChecklistPath)).toBe(true);
    expect(existsSync(signPathDraftPath)).toBe(true);
  });

  it("keeps the public README surfaces linked to the signing and privacy policy set", () => {
    expect(readmeEn).toContain("docs/CODE_SIGNING_POLICY.md");
    expect(readmeEn).toContain("docs/PRIVACY_POLICY.md");
    expect(readmeZh).toContain("docs/CODE_SIGNING_POLICY.md");
    expect(readmeZh).toContain("docs/PRIVACY_POLICY.md");
    expect(docsIndex).toContain("CODE_SIGNING_POLICY.md");
    expect(docsIndex).toContain("PRIVACY_POLICY.md");
    expect(docsIndex).toContain("MAINTAINER_SIGNING_GUIDE.md");
    expect(docsIndex).toContain("RELEASE_STRATEGY.md");
    expect(docsIndex).toContain("SIGNPATH_APPLICATION_CHECKLIST.md");
    expect(docsIndex).toContain("SIGNPATH_APPLICATION_DRAFT.md");
  });

  it("documents the signing roles, hosted workflow expectations, and portable-vs-installer distinction", () => {
    expect(codeSigningPolicy).toContain("Committers");
    expect(codeSigningPolicy).toContain("Reviewers");
    expect(codeSigningPolicy).toContain("Approvers");
    expect(codeSigningPolicy).toContain("GitHub Actions");
    expect(codeSigningPolicy).toContain("portable");
    expect(codeSigningPolicy).toContain("installer");
    expect(codeSigningPolicy).toContain("Vx.x.x");
  });

  it("documents the local-first privacy baseline while acknowledging optional configured integrations", () => {
    expect(privacyPolicy).toContain("local");
    expect(privacyPolicy).toContain("Loom");
    expect(privacyPolicy).toContain("Talk");
    expect(privacyPolicy).toContain("GitHub");
    expect(privacyPolicy).toContain("analytics");
  });

  it("records install/uninstall guidance and maintainer readiness notes for signing applications", () => {
    expect(distributionNotes).toContain("Install and uninstall notes");
    expect(distributionNotes).toContain("Program Files\\yamiyu\\Hook");
    expect(maintainerGuide).toContain("SignPath");
    expect(maintainerGuide).toContain("portable-first");
    expect(maintainerGuide).toContain("RELEASE_STRATEGY.md");
    expect(maintainerGuide).toContain("SIGNPATH_APPLICATION_CHECKLIST.md");
    expect(maintainerGuide).toContain("SIGNPATH_APPLICATION_DRAFT.md");
  });

  it("keeps a SignPath application checklist that separates repository facts, maintainer confirmations, copy-ready wording, and reviewer risk notes", () => {
    expect(signPathChecklist).toContain("Repository facts already prepared");
    expect(signPathChecklist).toContain("Maintainer facts to confirm before submission");
    expect(signPathChecklist).toContain("Copy-ready wording");
    expect(signPathChecklist).toContain("Risk and reviewer expectation notes");
    expect(signPathChecklist).toContain("CODE_SIGNING_POLICY.md");
    expect(signPathChecklist).toContain("PRIVACY_POLICY.md");
    expect(signPathChecklist).toContain("UIACCESS_DISTRIBUTION.md");
    expect(signPathChecklist).toContain("https://github.com/aiaimimi0920/Hook");
  });

  it("ships a copy-ready SignPath application draft that covers project description, signing need, release provenance, package distinction, and single-maintainer review explanation", () => {
    expect(signPathDraft).toContain("Project description");
    expect(signPathDraft).toContain("Why Hook needs code signing");
    expect(signPathDraft).toContain("How Hook releases are produced");
    expect(signPathDraft).toContain("Why portable and installer packages are different");
    expect(signPathDraft).toContain("Single-maintainer review explanation");
    expect(signPathDraft).toContain("Program Files");
    expect(signPathDraft).toContain("GitHub Actions");
    expect(signPathDraft).toContain("Vx.x.x");
  });

  it("documents the current portable-first phase and the future signed-installer switch in a dedicated maintainer strategy doc", () => {
    expect(releaseStrategy).toContain("portable-first");
    expect(releaseStrategy).toContain("signed-installer");
    expect(releaseStrategy).toContain("administrator");
    expect(releaseStrategy).toContain("GitHub Actions");
    expect(releaseStrategy).toContain("README.md");
    expect(releaseStrategy).toContain("release-hook-tag.yml");
  });
});
