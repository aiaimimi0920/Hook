"""Path oracle plus real Git regression tests for the documentation CI lane."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


scope = load('ci_change_scope')
docs = load('check_changed_docs')


class PathOracleTests(unittest.TestCase):
    def test_documentation_allowlist(self):
        for path in ['README.md', 'README.zh-CN.md', 'CONTRIBUTING.md', 'GOVERNANCE.md', 'SECURITY.md',
                     'MIGRATION.md', 'THIRD_PARTY_NOTICES.md', 'UIACCESS_DISTRIBUTION.md',
                     'docs/FEATURES.md', 'docs/nested/guide.md',
                     'docs/assets/demo.gif', 'docs/assets/nested/hero.svg']:
            with self.subTest(path=path):
                self.assertTrue(scope.is_documentation(path))

    def test_every_other_path_requires_full_ci(self):
        for path in ['src/app.tsx', 'src/README.md', 'src-tauri/src/lib.rs',
                     'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'package.json',
                     'package-lock.json', 'version-state.json', 'vite.config.ts',
                     'scripts/build.ps1', 'scripts/ci_change_scope.py',
                     '.github/workflows/build-otter-exe.yml', 'security/policy.json',
                     'docs/GITHUB_RELEASE_BODY.md', 'docs/assets/github-home-hero.svg',
                     'docs/assets/script.js',
                     'docs/settings.json', 'docs/template.html', 'public/icon.svg',
                     'new-file.txt', 'LICENSE', '../README.md', '/README.md',
                     'docs/../src/code.md', 'docs\\README.md', '']:
            with self.subTest(path=path):
                self.assertFalse(scope.is_documentation(path))

    def test_missing_event_manual_schedule_and_empty_diff_fail_closed(self):
        for event in ['workflow_dispatch', 'schedule', 'pull_request', 'push', 'unknown']:
            self.assertFalse(scope.classify(event, {})['docs_only'])
        with patch.object(scope, 'changed_paths', return_value=([], True, 'a', 'b')):
            self.assertFalse(scope.classify('push', {})['docs_only'])


class GitScopeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.old_cwd = Path.cwd()
        os.chdir(self.root)
        self.git('init', '-q')
        self.git('config', 'user.email', 'ci@example.invalid')
        self.git('config', 'user.name', 'CI test')
        self.write('README.md', '# Otter\n')
        self.write('src/code.ts', 'export const value = 1;\n')
        self.base = self.commit()

    def tearDown(self):
        os.chdir(self.old_cwd)
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.check_output(['git', *args], stderr=subprocess.PIPE).decode().strip()

    def write(self, path, content):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding='utf-8')

    def commit(self):
        self.git('add', '.')
        self.git('commit', '-qm', 'test')
        return self.git('rev-parse', 'HEAD')

    def classify(self, head, base=None, event='push'):
        base = base or self.base
        data = {'before': base, 'after': head}
        if event == 'pull_request':
            data = {'pull_request': {'base': {'sha': base}, 'head': {'sha': head}}}
        return scope.classify(event, data)

    def test_readme_push_and_pull_request(self):
        self.write('README.md', '# Updated\n')
        head = self.commit()
        for event in ['push', 'pull_request']:
            self.assertTrue(self.classify(head, event=event)['docs_only'])

    def test_mixed_change_and_code_deletion(self):
        self.write('README.md', '# Updated\n')
        (self.root / 'src/code.ts').unlink()
        self.assertFalse(self.classify(self.commit())['docs_only'])

    def test_code_renamed_into_docs_is_not_docs_only(self):
        self.git('mv', 'src/code.ts', 'README.zh-CN.md')
        result = self.classify(self.commit())
        self.assertFalse(result['docs_only'])
        self.assertIn('src/code.ts', result['paths'])

    def test_docs_rename_and_deletion_are_classified(self):
        self.git('mv', 'README.md', 'README.zh-CN.md')
        result = self.classify(self.commit())
        self.assertTrue(result['docs_only'])
        self.assertEqual(set(result['paths']), {'README.md', 'README.zh-CN.md'})

    def test_missing_base_and_new_branch_require_full_ci(self):
        self.write('README.md', '# Updated\n')
        head = self.commit()
        for base in ['0' * 40, '1' * 40, '--help']:
            self.assertFalse(self.classify(head, base)['docs_only'])
        self.assertFalse(scope.classify('push', {
            'before': self.base, 'after': head, 'created': True})['docs_only'])

    def test_multi_commit_push_does_not_look_only_at_last_commit(self):
        self.write('src/code.ts', 'export const value = 2;\n')
        self.commit()
        self.write('README.md', '# Updated\n')
        self.assertFalse(self.classify(self.commit())['docs_only'])

    def test_pr_merge_base_preserves_branch_code_changes(self):
        self.write('src/code.ts', 'export const value = 2;\n')
        head = self.commit()
        self.git('checkout', '-q', '--detach', self.base)
        self.write('README.md', '# Base branch update\n')
        base_tip = self.commit()
        self.assertFalse(self.classify(head, base_tip, 'pull_request')['docs_only'])

    def test_deleted_docs_with_incoming_links_fail_documentation_check(self):
        self.write('docs/guide.md', '# Guide\n')
        self.write('README.md', '# Otter\n[guide](docs/guide.md)\n')
        base = self.commit()
        (self.root / 'docs/guide.md').unlink()
        result = self.classify(self.commit(), base)
        self.assertTrue(result['docs_only'])
        self.write('.ci-change-scope.json', json.dumps(result))
        with self.assertRaisesRegex(SystemExit, 'link to removed document'):
            docs.main()

    def test_deleted_last_file_invalidates_directory_links(self):
        self.write('docs/guide/index.md', '# Guide\n')
        self.write('README.md', '# Otter\n[guide](docs/guide/)\n')
        base = self.commit()
        (self.root / 'docs/guide/index.md').unlink()
        result = self.classify(self.commit(), base)
        self.write('.ci-change-scope.json', json.dumps(result))
        with self.assertRaisesRegex(SystemExit, 'removed document or directory'):
            docs.main()

    def test_generated_and_git_metadata_link_targets_are_not_repository_files(self):
        for target in ['.git/config', '.ci-change-scope.json', 'untracked.md']:
            self.write('README.md', f'# Otter\n[bad]({target})\n')
            result = self.classify(self.commit())
            self.write('.ci-change-scope.json', json.dumps(result))
            self.write('untracked.md', '# Untracked\n')
            with self.assertRaisesRegex(SystemExit, 'missing or out-of-repository'):
                docs.main()
            Path('.ci-change-scope.json').unlink()
            Path('untracked.md').unlink()

    def test_documentation_cli_output_and_full_fallback(self):
        self.write('README.md', '# Updated\n')
        head = self.commit()
        self.write('event.json', json.dumps({'before': self.base, 'after': head}))
        with patch.dict(os.environ, GITHUB_EVENT_PATH='event.json',
                        GITHUB_EVENT_NAME='push', GITHUB_OUTPUT='output'):
            scope.main()
            self.assertEqual(Path('output').read_text(), 'full=false\n')
            self.write('event.json', '{invalid')
            scope.main()
            self.assertTrue(Path('output').read_text().endswith('full=true\n'))

    def test_executable_document_requires_full_ci(self):
        self.git('update-index', '--chmod=+x', 'README.md')
        self.git('commit', '-qm', 'mode change')
        self.assertFalse(self.classify(self.git('rev-parse', 'HEAD'))['docs_only'])

    def test_deleted_executable_document_requires_full_ci(self):
        self.git('update-index', '--chmod=+x', 'README.md')
        self.git('commit', '-qm', 'mode change')
        base = self.git('rev-parse', 'HEAD')
        (self.root / 'README.md').unlink()
        self.assertFalse(self.classify(self.commit(), base)['docs_only'])

    @unittest.skipIf(os.name == 'nt', 'Windows requires symlink privilege')
    def test_symlink_document_requires_full_ci(self):
        (self.root / 'README.zh-CN.md').symlink_to('src/code.ts')
        self.assertFalse(self.classify(self.commit())['docs_only'])


class DocumentationTests(unittest.TestCase):
    def test_local_links_and_html_images(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / 'target.md').write_text('# Target\n')
            (root / 'README.md').write_text(
                '# Example\n[valid](target.md#heading)\n<img src="target.md">\n'
                '[web](https://example.invalid/)\n`[example](missing.md)`\n')
            self.assertEqual(docs.check_document(root, 'README.md'), [])
            (root / 'README.md').write_text('# Broken\n[bad](missing.md)\n')
            self.assertTrue(docs.check_document(root, 'README.md'))

    def test_matching_multibacktick_code_spans_hide_illustrative_links(self):
        for text in ['`` `[example](missing.md)` ``',
                     '``` text `` [example](missing.md) `` text ```',
                     '`` multiline\n[example](missing.md) ``']:
            self.assertEqual(list(docs.local_targets(text)), [])
        self.assertEqual(list(docs.local_targets('``unclosed [real](target.md)')), ['target.md'])

    def test_html_attributes_allow_spacing_case_and_unquoted_values(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / 'target.md').write_text('# Target\n')
            for attribute in ['HREF = "target.md"', "sRc = 'target.md'", 'href=target.md']:
                path = root / 'README.md'
                path.write_text(f'<A {attribute}>link</A>\n')
                self.assertEqual(docs.check_document(root, 'README.md'), [])
                path.write_text(f'<IMG {attribute.replace("target.md", "missing.md")} />\n')
                self.assertTrue(docs.check_document(root, 'README.md'))

    def test_footnotes_are_not_reference_link_destinations(self):
        text = 'Text[^note].\n[^note]: Explanation of the result.\n[guide]: missing.md\n'
        self.assertEqual(list(docs.local_targets(text)), ['missing.md'])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / 'README.md').write_text('Text[^note].\n[^note]: Explanation.\n')
            self.assertEqual(docs.check_document(root, 'README.md'), [])

    def test_setext_heading_and_balanced_parenthesis_destinations(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / 'guide(v2).md').write_text('# Guide\n')
            (root / 'README.md').write_text(
                'Title\n=======\n[guide](guide(v2).md)\n'
                '[escaped](guide\\(v2\\).md)\n[angle](<guide(v2).md>)\n')
            self.assertEqual(docs.check_document(root, 'README.md'), [])

    def test_only_known_sibling_contract_pairs_are_external(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / 'docs').mkdir()
            for source, targets in docs.SIBLING_CONTRACT_LINKS.items():
                path = root / source
                for target in targets:
                    path.write_text(f'# Contract\n[external]({target})\n')
                    self.assertEqual(docs.check_document(root, source), [])
                    (root / 'README.md').write_text(path.read_text())
                    self.assertTrue(docs.check_document(root, 'README.md'))
                for target in ['../../Loom/protocol/unknown.md', '../../Other/docs/TILE_WALL.md',
                               '../../Loom/docs/../private.md', '../../../outside.md']:
                    path.write_text(f'# Contract\n[bad]({target})\n')
                    self.assertTrue(docs.check_document(root, source))

    def test_conflicts_empty_and_escape_links_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for text in ['', '<<<<<<< HEAD\n', '# Unsafe\n[bad](../outside.md)\n']:
                (root / 'README.md').write_text(text)
                self.assertTrue(docs.check_document(root, 'README.md'))


if __name__ == '__main__':
    unittest.main()
