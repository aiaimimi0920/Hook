# Hook Portable-First Release Phase Design

## Goal

Shift Hook's current public release posture into a **portable-first transitional
phase**:

1. keep all installer/UIAccess/signing engineering preparation in the
   repository;
2. publicly publish only the **portable** Windows package for now;
3. document **Run as administrator** as the current workaround when users hit
   foreground/elevation interaction limits;
4. preserve a clean path to switch back to a signed installer-first release
   model once real signing material is available.

## Approved approach

Use a **phase-based release strategy**:

- **Current phase:** portable-first public releases
- **Future phase:** signed installer public releases

The repository keeps the future installer path ready, but current GitHub Actions
and README guidance must describe the portable package as the only public
release asset until signing is wired for real.

## Why this change is needed

The repository currently contains two truths at once:

- technically, Hook now has UIAccess build/signing/install scaffolding;
- operationally, the project does not yet have real SignPath or equivalent
  signing material.

That means the public documentation and workflows should not imply that the
installer lane is part of the current user-facing release contract.

## Release-phase contract

### Current public phase

The current public release phase must behave like this:

- GitHub release assets contain only the **portable** zip
- GitHub build artifacts for normal development runs expose only the portable
  executable artifact
- README describes **portable** as the current recommended package
- README explains that **Run as administrator** is the current workaround for
  Windows interaction limits
- installer/UIAccess artifacts are treated as **future** public release outputs

### Future signed-installer phase

Once real signing material is available:

- the repository can switch public releases back to dual distribution
- installer/UIAccess assets can become public release artifacts
- README can change installer guidance back to the recommended path

## Non-goals

This change does **not**:

- remove the UIAccess manifest
- remove the installer packaging scripts
- remove local UIAccess testing helpers
- delete signing policy documentation
- abandon the future signed-installer path

## Files and responsibilities

### Public user-facing docs

- `README.md`
- `README.zh-CN.md`
- `UIACCESS_DISTRIBUTION.md`

These must describe the current phase clearly and consistently.

### Maintainer/process docs

- `docs/RELEASE_STRATEGY.md`
- `docs/README.md`
- `docs/CODE_SIGNING_POLICY.md`
- `docs/MAINTAINER_SIGNING_GUIDE.md`
- `docs/SIGNPATH_APPLICATION_CHECKLIST.md`
- `docs/SIGNPATH_APPLICATION_DRAFT.md`

These must explain:

- why the current public release is portable-only
- why installer prep still stays in the repo
- what changes when signing becomes available

### GitHub Actions

- `.github/workflows/build-hook-exe.yml`
- `.github/workflows/release-hook-tag.yml`

These must only produce public portable outputs in the current phase.

## Workflow design

### Development build workflow

`build-hook-exe.yml` should:

- continue building the portable executable on `main` pushes / manual runs
- upload only the portable artifact
- stop publishing the current UIAccess installer artifact in this phase

### Tag release workflow

`release-hook-tag.yml` should:

- continue releasing on `V*.*.*` tags
- package and publish only `hook-windows-x64-<tag>.zip`
- stop publishing `hook-windows-uiaccess-installer-<tag>.zip` in this phase

The UIAccess build/sign steps may stay available only if they are explicitly
framed as future wiring, but the simplest and clearest contract for this phase
is to remove them from the public release workflow until signing exists.

## Documentation design

### README wording

README must change from:

- installer recommended when available

to:

- portable currently recommended
- administrator launch is the current workaround
- signed installer is planned for future signed releases

### UIAccess distribution notes

`UIACCESS_DISTRIBUTION.md` should become explicitly phase-based:

- explain why the installer path exists architecturally
- explain why the project is not publicly shipping it yet
- explain the current admin-launch workaround
- explain the future signed-installer switch

### Release strategy doc

Add `docs/RELEASE_STRATEGY.md` to act as the maintainer-facing high-level
release-phase description:

- current phase
- future phase
- switch conditions
- files that must change when the project flips phases

## Testing strategy

Update contract tests so they verify the **current** public release contract
rather than the future dual-distribution contract:

1. build workflow uploads only the portable artifact
2. release workflow publishes only the portable zip
3. README points users to portable-first guidance
4. UIAccess/signing docs still exist and still explain the future installer
   path
5. release-strategy doc exists and documents current vs future phase

UIAccess build/install contract tests should remain, because the repository is
still supposed to stay ready for the future signed-installer phase.

## Error-handling / consistency rules

- do not describe an unsigned installer as publicly supported
- do not describe the portable package as functionally identical to the future
  signed installer path
- do not remove installer-prep scripts or manifest just because public release
  is currently portable-only

## Success criteria

This design is complete when:

1. users reading README understand that the current public package is portable
   first;
2. maintainers can see a documented path back to signed installer releases;
3. GitHub Actions no longer publicly emit installer assets in the current
   phase;
4. the repository still retains all future UIAccess/signing engineering
   preparation.
