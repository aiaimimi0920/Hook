# Hook Portable-First Release Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe Hook's current public release contract so GitHub and README expose only the portable package, while preserving the future signed installer path in code and maintainer docs.

**Architecture:** Update repository contract tests first, then align workflows and public docs to a portable-first phase model. Keep UIAccess build/install scaffolding and signing-process docs in place, but stop public build/release workflows from emitting installer artifacts until real signing exists.

**Tech Stack:** GitHub Actions, PowerShell packaging scripts, Vitest integration contract tests, Markdown docs, Tauri/Rust UIAccess scaffolding.

---

### Task 1: Update release-phase contract tests

**Files:**
- Modify: `__tests__/integration/HookDualDistributionContract.test.ts`
- Modify: `__tests__/integration/HookReleaseWorkflowContract.test.ts`
- Modify: `__tests__/integration/HookSigningDocsContract.test.ts`

- [ ] **Step 1: Rewrite workflow expectations so current public artifacts are portable-only**
- [ ] **Step 2: Add a contract for the new release-strategy document**
- [ ] **Step 3: Run targeted Vitest commands and verify the new assertions fail against the old workflow/docs**

### Task 2: Add portable-first release strategy documentation

**Files:**
- Create: `docs/RELEASE_STRATEGY.md`
- Modify: `docs/README.md`
- Modify: `docs/CODE_SIGNING_POLICY.md`
- Modify: `docs/MAINTAINER_SIGNING_GUIDE.md`
- Modify: `docs/SIGNPATH_APPLICATION_CHECKLIST.md`
- Modify: `docs/SIGNPATH_APPLICATION_DRAFT.md`

- [ ] **Step 1: Add a maintainer-facing release strategy doc with current and future phases**
- [ ] **Step 2: Update docs index and signing docs so they consistently describe the current portable-first phase**
- [ ] **Step 3: Re-run the signing/release doc contract tests**

### Task 3: Update README and UIAccess public guidance

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `UIACCESS_DISTRIBUTION.md`

- [ ] **Step 1: Change README wording so portable is the current recommended package**
- [ ] **Step 2: Document administrator launch as the current workaround**
- [ ] **Step 3: Reframe UIACCESS_DISTRIBUTION.md as current portable-first / future signed-installer guidance**
- [ ] **Step 4: Re-run README and UIAccess-related contract tests**

### Task 4: Update GitHub Actions to portable-only public outputs

**Files:**
- Modify: `.github/workflows/build-hook-exe.yml`
- Modify: `.github/workflows/release-hook-tag.yml`

- [ ] **Step 1: Remove current-phase installer artifact publication from the normal build workflow**
- [ ] **Step 2: Remove current-phase installer asset publication from the tag release workflow**
- [ ] **Step 3: Keep the repository's future installer scaffolding intact outside the public release workflows**
- [ ] **Step 4: Re-run workflow contract tests**

### Task 5: Verify repository state

**Files:**
- Verify only

- [ ] **Step 1: Run targeted Vitest commands covering release workflow, UIAccess scaffolding, README localization, and signing docs**
- [ ] **Step 2: Run `cargo check --manifest-path src-tauri/Cargo.toml`**
- [ ] **Step 3: Inspect `git diff --stat` and confirm only intended release-phase files changed**
