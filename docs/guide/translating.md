# Help translate Otter

[简体中文](./translating.zh-CN.md) · [Ways to contribute](./contributing.md) · [Documentation](../README.md)

Help improve English and Chinese introductions, translate guides or suggest
clearer interface wording. Start with one sentence; you do not need a Windows
development environment to suggest a correction. This guide covers project copy
and documentation, not using OCR or translating captured image content.

## Start with a suggestion

Search [existing issues](https://github.com/aiaimimi0920/Otter/issues). If no
matching suggestion exists, [open an issue](https://github.com/aiaimimi0920/Otter/issues/new) with:

- The target language and document link or interface location.
- The original text, proposed wording and reason.
- Necessary context or reproduction steps; remove private content from screenshots.

For example, explain whether a button reruns an operation or only shows a cached
result. If the behavior is unclear, state the question instead of inventing a
capability in the translation.

## Where wording lives

| Content | Existing location and approach |
| --- | --- |
| Introduction and getting started | Maintain the [English README](../../README.md) and [Chinese README](../../README.zh-CN.md) together. |
| Community participation | [English guide](./contributing.md) and [Chinese guide](./contributing.zh-CN.md). |
| This translation guide | This page and its [Chinese counterpart](./translating.zh-CN.md). |
| Other product and technical documents | Find the existing owner in the [documentation index](../README.md). Not every document has a translation; do not link to a translation that does not exist. |
| Toolbar options | [stickerTopStripCatalog.tsx](../../src/components/stickerTopStripCatalog.tsx) stores display labels directly, including selection and movement labels. |
| Component labels and hints | Examples include button titles and accessibility labels in [StickerTopStripEditActions.tsx](../../src/components/StickerTopStripEditActions.tsx), and settings copy in [AppSettingsDialog.tsx](../../src/components/AppSettingsDialog.tsx). |

The inspected interface wording lives directly in components and option catalogs.
Copying another project's language-file structure does not enable an Otter UI
translation. Interface text edits are code changes: find the actual caller and
follow the [engineering contribution guide](../../CONTRIBUTING.md). Bilingual
documentation does not imply an application language switcher.

## Edit a document

1. Read the full passage and relevant feature description to establish current behavior.
2. Edit its Markdown file on your own working branch. Small changes can also be
   proposed through GitHub's file editor.
3. A typo fix may affect one language. Changes to meaning or steps should update
   existing corresponding language versions.
4. Discuss the language, scope, filename and entry point before adding a full
   translation. Place it in the same topic directory, add reciprocal language
   links and include it in the documentation index.
5. Preview formatting and check links, anchors, image descriptions, tables and
   code examples. Submit a PR explaining the scope and any verification gaps.

Documentation-only translation does not require running native screen capture.
Interface or native-behavior changes follow the relevant engineering checks.
Do not report unrun checks as passed or present a wording correction as functional acceptance.

## Preserve meaning and identifiers

- Keep product and protocol names such as Otter, Loom and Art accurate.
- Preserve commands, code, configuration keys, shortcuts, filenames, URL targets
  and protocol identifiers. Link labels may be translated.
- Preserve interpolation expressions, placeholders and escapes in source strings.
  Do not change enum values, action identifiers or conditions to translate text.
- Retain platform limits, capability installation/authorization requirements,
  signing status and verification boundaries.
- Update anchor links after changing headings. Keep visible labels, hints and
  accessibility labels consistent about what an action does.
- Preserve license texts and third-party notices. Review machine-assisted
  translations against their actual context.

## Propose a complete interface language

Discuss the scope and design in an issue first: string ownership, language
selection and defaults, formatting and placeholders, fonts and layout,
accessibility labels and verification. A language mechanism needs implementation
and testing; translating a few strings does not establish support for a new UI
language. Otter's translation target-language setting is for content translation,
not an interface-language registration point.

Remove private content and credentials from screenshots, logs and examples.
Follow the [security reporting process](../../SECURITY.md#reporting-a-vulnerability) for security issues.
