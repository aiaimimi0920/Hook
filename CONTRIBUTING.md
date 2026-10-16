# Contributing to Otter

Thank you for helping improve Otter. Bug reports, translations, documentation,
workflow examples and code contributions are all welcome — you do not need to
write code to take part.

[Simplified Chinese](docs/guide/contributing.zh-CN.md) · [Documentation](docs/README.md) · [Browse issues](https://github.com/aiaimimi0920/Otter/issues)

## Find your starting point

| I want to… | Start here |
| --- | --- |
| Report a bug or suggest an improvement | Search [existing issues](https://github.com/aiaimimi0920/Otter/issues), then describe the problem and expected result. |
| Improve wording or translate documentation | Read the [translation guide](docs/guide/translating.md) / [Simplified Chinese](docs/guide/translating.zh-CN.md). |
| Share a workflow or help other users | See [ways to contribute](docs/guide/contributing.md). Remove private images, tokens and personal data from examples. |
| Fix a bug or develop a feature | Follow the [development guide](docs/guide/development.md) / [Simplified Chinese](docs/guide/development.zh-CN.md), then find the owning module in the [code organization standard](docs/development/CODE_ORGANIZATION.md). |
| Report a security vulnerability | Use the [security policy](SECURITY.md), not a public bug report containing exploit details. |

## Make your first contribution

1. **Check the existing discussion.** For a larger feature or structural change,
   discuss the scope in an issue before investing in a broad implementation.
2. **Work on a focused branch from `main`.** Keep unrelated cleanup separate and
   preserve existing behavior outside your change.
3. **Read the owning code and guidance.** Otter is a Windows-first Tauri/SolidJS
   application. Use current implementation and tests, not historical plans, as
   the source of truth. Read [AGENTS.md](AGENTS.md) and the
   [engineering requirements](docs/development/ENGINEERING.md) for code work.
4. **Verify what you changed.** Run the relevant tests and checks. Documentation-only
   changes need link/content checks and their consuming contract tests, not an EXE rebuild.
5. **Open a pull request.** Explain the problem, the change, how you verified it,
   and anything still untested. Include before/after screenshots for visible UI changes,
   with private information removed.

For bug reports, include the Otter version, Windows version, reproduction steps,
expected versus actual behavior, and relevant sanitized logs or screenshots.
Mention display scaling or monitor layout when the problem involves capture or positioning.

## Before opening a pull request

- [ ] The change has one clear purpose and does not remove unrelated work or data.
- [ ] Relevant checks pass; untested native or cross-device behavior is stated explicitly.
- [ ] Documentation and both language variants are updated when affected.
- [ ] No credentials, private screenshots, local logs or generated build output are included.
- [ ] `git diff --check` is clean.

## Development and verification

Otter is built with SolidJS, TypeScript, Rust and Tauri for Windows. Use the
[development guide](docs/guide/development.md) for prerequisites and setup; a browser
preview alone cannot validate native capture, input or desktop behavior.

Before changing code, read the [engineering requirements](docs/development/ENGINEERING.md)
and [code organization standard](docs/development/CODE_ORGANIZATION.md). These cover
module ownership, state and resource lifetimes, testing, and release boundaries.

| Your change | Verification to include in the PR |
| --- | --- |
| Documentation or translation | Check affected links, anchors, examples and language consistency; run the documentation contracts that consume those files. |
| Frontend behavior | Relevant tests, typechecks and lint; describe visible behavior and add regression coverage. |
| Native capture or desktop input | Relevant Rust and frontend checks, plus the applicable Windows runtime verification. |
| Packaging or dependencies | Follow the release and dependency-security gates in the engineering requirements. |

See the [verification requirements](docs/development/ENGINEERING.md#6-tests-and-verification)
for commands and CI behavior. Report which checks you actually ran; compilation,
mocked tests and browser tests do not substitute for native or cross-device acceptance.

## Review and follow-up

Keep the pull request description focused on the problem and the evidence for the
solution. Link the relevant issue when one exists. Maintainers may ask for a smaller
scope, additional tests or documentation changes before merging. Do not combine a
public release, version-tag change or external deployment with an ordinary fix
unless that work has been agreed separately.
