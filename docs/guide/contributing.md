# Contributing

[简体中文](./contributing.zh-CN.md) · [Documentation](../README.md) · [Engineering contribution guide](../../CONTRIBUTING.md)

Start with a bug report, a wording correction or a useful example to help make
Otter better. You do not need to write code to contribute. Implementation changes
follow the existing engineering setup and verification requirements.

## Choose a way to help

| Contribution | Start here |
| --- | --- |
| Report a problem | Search [existing issues](https://github.com/aiaimimi0920/Otter/issues), then [open an issue](https://github.com/aiaimimi0920/Otter/issues/new) with the version, environment and reproduction steps if no matching report exists. |
| Suggest a feature | Describe the use case, your current approach, the difficulty and the result you want. Note any required Loom capabilities and connection conditions. |
| Share a useful example | Use an issue to explain a reproducible capture, annotation or node-processing example with sanitized images, steps, results and required versions or capabilities. |
| Improve wording or documentation | Identify the page, original wording, proposed text and reason. Open an issue or propose a documentation PR; see the [translation guide](./translating.md) and [Wording and documentation](#wording-and-documentation). |
| Contribute code | Read the [engineering contribution guide](../../CONTRIBUTING.md) and [repository layout](../../TECHNICAL_ARCHITECTURE.md#2-repository-layout), then make a focused change with relevant verification. |

## Make a problem reproducible

A useful report can include:

1. Otter version or commit, release package name and Windows version.
2. Starting state, ordered steps, expected result and actual result.
3. Relevant environment details such as display count, scaling, HDR status or
   source application. Omit details that do not affect the problem.
4. For OCR, translation or projection, include the Loom version, whether the
   required capabilities are installed and enabled, and connection/authorization state.
5. A minimal example, sanitized screenshots or necessary log excerpts, with a
   clear distinction between verified steps and anything you could not verify.

Live capture follows program or screen-region pixels: browser scrolling and tab
switches change the captured content. Check [live capture scope](../LIVE_CAPTURE.md)
and [projection behavior](../QR_PROJECTION.md) to distinguish limits from defects.
Do not infer display FPS or performance gains from receive/decode counters or a
single screenshot; see the [LiveRelay diagnostics boundaries](../LIVE_RELAY_DIAGNOSTICS.md).

## Wording and documentation

| Content | Location |
| --- | --- |
| Project introduction and entry points | [English README](../../README.md) and [Chinese README](../../README.zh-CN.md) |
| Documentation navigation | [Documentation index](../README.md) |
| Ways to participate | This page and the [Chinese contribution guide](./contributing.zh-CN.md) |
| Features and shortcuts | [Feature matrix](../FEATURES.md) and the focused guides linked from the documentation index |
| Architecture, development and verification | [Technical architecture](../../TECHNICAL_ARCHITECTURE.md) and [engineering contribution guide](../../CONTRIBUTING.md) |

A typo fix may affect one language. Changes to meaning, limitations or steps should
update the existing corresponding English and Chinese content. For interface
wording, identify the control or navigation path; do not assume Otter uses another
project's localization-file structure.

Preserve commands, settings, shortcuts, protocol identifiers, download filenames
and link targets. Translate labels and image descriptions without overstating
capabilities. Check anchor links after changing headings. Keep platform limits,
capability installation/authorization requirements, signing status and verification
boundaries intact. Preserve license texts and third-party notices.

Place new guides in a suitable topic location under `docs/` and link them from the
index. Prefer improving an existing owner over duplicating a feature's rules.
Do not move existing documents merely to tidy the directory.

## Propose an improvement

1. Search related issues and PRs and establish the scope. Discuss larger changes
   first to avoid duplicate work.
2. Start your own working branch from current code and change only related files.
3. For documentation, check links, images, anchors, code examples and bilingual
   consistency. Code changes follow the [engineering verification requirements](../../CONTRIBUTING.md#6-tests-and-verification).
4. Explain what changed, why, the checks performed and remaining verification gaps
   in the PR. Show actual results; a simulated demo is not native acceptance evidence.

A suggestion or PR does not imply a merge, release or support for every device and
scenario. Maintainer review and relevant verification determine acceptance.

## Check privacy and permission before sharing

Public issues and PRs can be read by anyone. Remove private image content and
credentials, tokens, personal paths and unnecessary personal data from logs.
Share only material you are allowed to publish, without other people's private
screens, unauthorized assets or usable device-pairing information.

Report suspected vulnerabilities through the [security reporting process](../../SECURITY.md#reporting-a-vulnerability).
Do not publish exploit details or sensitive material. If private reporting is
unavailable, follow that policy's minimal-issue route to request a private channel.
