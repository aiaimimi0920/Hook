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
const securityPolicyPath = resolve(hookRoot, "SECURITY.md");
const governancePath = resolve(hookRoot, "GOVERNANCE.md");
const thirdPartyNoticesPath = resolve(hookRoot, "THIRD_PARTY_NOTICES.md");
const releaseBodyPath = resolve(hookRoot, "docs/GITHUB_RELEASE_BODY.md");

const codeSigningPolicy = readFileSync(codeSigningPolicyPath, "utf8");
const privacyPolicy = readFileSync(privacyPolicyPath, "utf8");
const maintainerGuide = readFileSync(maintainerGuidePath, "utf8");
const releaseStrategy = readFileSync(releaseStrategyPath, "utf8");
const signPathChecklist = readFileSync(signPathChecklistPath, "utf8");
const signPathDraft = readFileSync(signPathDraftPath, "utf8");
const distributionNotes = readFileSync(distributionNotesPath, "utf8");
const securityPolicy = readFileSync(securityPolicyPath, "utf8");
const governance = readFileSync(governancePath, "utf8");
const thirdPartyNotices = readFileSync(thirdPartyNoticesPath, "utf8");
const releaseBody = readFileSync(releaseBodyPath, "utf8");

describe("Hook signing docs contract", () => {
  it("ships public signing/privacy docs, a maintainer signing guide, a release strategy doc, a SignPath application checklist, and a submission draft", () => {
    expect(existsSync(codeSigningPolicyPath)).toBe(true);
    expect(existsSync(privacyPolicyPath)).toBe(true);
    expect(existsSync(maintainerGuidePath)).toBe(true);
    expect(existsSync(releaseStrategyPath)).toBe(true);
    expect(existsSync(signPathChecklistPath)).toBe(true);
    expect(existsSync(signPathDraftPath)).toBe(true);
    expect(existsSync(securityPolicyPath)).toBe(true);
    expect(existsSync(governancePath)).toBe(true);
    expect(existsSync(thirdPartyNoticesPath)).toBe(true);
    expect(existsSync(releaseBodyPath)).toBe(true);
  });

  it("keeps the public README surfaces linked to the signing and privacy policy set", () => {
    expect(readmeEn).toContain("docs/CODE_SIGNING_POLICY.md");
    expect(readmeEn).toContain("docs/PRIVACY_POLICY.md");
    expect(readmeEn).toContain("SECURITY.md");
    expect(readmeEn).toContain("GOVERNANCE.md");
    expect(readmeEn).toContain("THIRD_PARTY_NOTICES.md");
    expect(readmeEn).toContain("Free code signing provided by [SignPath.io]");
    expect(readmeZh).toContain("docs/CODE_SIGNING_POLICY.md");
    expect(readmeZh).toContain("docs/PRIVACY_POLICY.md");
    expect(readmeZh).toContain("SECURITY.md");
    expect(readmeZh).toContain("GOVERNANCE.md");
    expect(readmeZh).toContain("Free code signing provided by [SignPath.io]");
    expect(docsIndex).toContain("CODE_SIGNING_POLICY.md");
    expect(docsIndex).toContain("PRIVACY_POLICY.md");
    expect(docsIndex).toContain("MAINTAINER_SIGNING_GUIDE.md");
    expect(docsIndex).toContain("RELEASE_STRATEGY.md");
    expect(docsIndex).toContain("SIGNPATH_APPLICATION_CHECKLIST.md");
    expect(docsIndex).toContain("SIGNPATH_APPLICATION_DRAFT.md");
    expect(docsIndex).toContain("GITHUB_RELEASE_BODY.md");
  });

  it("documents the signing roles, hosted workflow expectations, and portable-vs-installer distinction", () => {
    expect(codeSigningPolicy).toContain("Committers");
    expect(codeSigningPolicy).toContain("Reviewers");
    expect(codeSigningPolicy).toContain("Approvers");
    expect(codeSigningPolicy).toContain("GitHub Actions");
    expect(codeSigningPolicy).toContain("portable");
    expect(codeSigningPolicy).toContain("installer");
    expect(codeSigningPolicy).toContain("Vx.x.x");
    expect(codeSigningPolicy).toContain("Every release signing request requires manual approval");
    expect(codeSigningPolicy).toContain("signpath/github-action-submit-signing-request@v2");
  });

  it("documents the local-first privacy baseline while acknowledging optional configured integrations", () => {
    expect(privacyPolicy).toContain("local");
    expect(privacyPolicy).toContain("Loom");
    expect(privacyPolicy).toContain("Talk");
    expect(privacyPolicy).toContain("GitHub");
    expect(privacyPolicy).toContain("analytics");
    expect(privacyPolicy).toContain("will not transfer any information to other networked systems");
  });

  it("records install/uninstall guidance and maintainer readiness notes for signing applications", () => {
    expect(distributionNotes).toContain("Install and uninstall notes");
    expect(distributionNotes).toContain("Program Files\\yamiyu\\Hook");
    expect(maintainerGuide).toContain("SignPath");
    expect(maintainerGuide).toContain("portable-first");
    expect(maintainerGuide).toContain("RELEASE_STRATEGY.md");
    expect(maintainerGuide).toContain("SIGNPATH_APPLICATION_CHECKLIST.md");
    expect(maintainerGuide).toContain("SIGNPATH_APPLICATION_DRAFT.md");
    expect(distributionNotes).toContain("scripts/install-hook-uiaccess.ps1 -SourceExe");
    expect(distributionNotes).not.toContain("HOOK_WINDOWS_UIACCESS_PFX_BASE64");
    expect(securityPolicy).toContain("Reporting a vulnerability");
    expect(securityPolicy).toContain("not intended to exploit vulnerabilities");
    expect(governance).toContain("Authors / Committers");
    expect(governance).toContain("Reviewers");
    expect(governance).toContain("Approvers");
    expect(governance).toContain("@aiaimimi0920");
    expect(thirdPartyNotices).toContain("Cap `scap-*` capture crates");
    expect(thirdPartyNotices).toContain("CrabNebula `drag` crate");
    expect(releaseBody).toContain("Free code signing provided by [SignPath.io]");
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
