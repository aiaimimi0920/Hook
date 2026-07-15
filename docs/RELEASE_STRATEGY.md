# Hook Release Strategy

This document explains Hook's current public release phase and the planned
future release phase.

## Current phase: portable-first

Hook is currently in a **portable-first** public release phase.

That means:

- public GitHub release assets publish only the portable Windows zip;
- normal GitHub Actions build artifacts expose only the portable executable;
- README currently recommends the portable package as the user-facing default;
- if users hit Windows foreground/elevation interaction limits, the current
  workaround is to launch the portable build as **administrator**.

## Why the repository still keeps installer/UIAccess prep

Hook still keeps all future signed-installer engineering preparation in-repo,
including:

- UIAccess manifest wiring
- installer packaging scripts
- local UIAccess test helpers
- signing policy / SignPath preparation docs

Those pieces stay checked in so the project can switch phases cleanly once real
signing material is available.

## Future phase: signed-installer

Hook's intended future public phase is the **signed-installer** phase.

That phase begins once:

1. a real signing provider path exists;
2. release signing is operational in GitHub Actions;
3. the project is ready to publish a signed installer/UIAccess asset publicly.

When that happens, the public release posture can switch back to:

- portable + signed installer dual distribution;
- installer guidance restored as the recommended path for the most reliable
  Windows interaction scenarios.

## Files that define the current phase

The current portable-first phase is reflected in:

- `README.md`
- `README.zh-CN.md`
- `UIACCESS_DISTRIBUTION.md`
- `.github/workflows/build-hook-exe.yml`
- `.github/workflows/release-hook-tag.yml`

## Files that preserve the future installer path

The future signed-installer path is preserved by:

- `scripts/install-hook-uiaccess.ps1`
- `scripts/package-uiaccess-installer-zip.ps1`
- `scripts/setup-hook-uiaccess-local-test.ps1`
- `src-tauri/windows/uiaccess.manifest.xml`
- `docs/CODE_SIGNING_POLICY.md`
- `docs/MAINTAINER_SIGNING_GUIDE.md`
- `docs/SIGNPATH_APPLICATION_CHECKLIST.md`
- `docs/SIGNPATH_APPLICATION_DRAFT.md`

## Switching phases later

When Hook moves from portable-first to signed-installer public releases, update
all of the following together:

- `README.md`
- `README.zh-CN.md`
- `UIACCESS_DISTRIBUTION.md`
- `.github/workflows/build-hook-exe.yml`
- `.github/workflows/release-hook-tag.yml`
- related integration contract tests

Do not partially flip the phase. The docs and GitHub Actions contract should
change together.
