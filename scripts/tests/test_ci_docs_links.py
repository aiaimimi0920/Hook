"""Regression coverage for rendered Markdown and responsive HTML link targets."""
from pathlib import Path
import tempfile
import unittest

from test_ci_change_scope import docs


class RenderedLinkTests(unittest.TestCase):
    def test_domain_root_links_are_not_checkout_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for target in ['/README.md', '/%52EADME.md', '&#47;README.md']:
                (root / 'README.md').write_text(f'[bad]({target})\n')
                self.assertIn('domain-root', docs.check_document(root, 'README.md')[0])

    def test_indented_code_and_comments_do_not_create_links(self):
        for text in ['    [example](missing.md)\n', '\t[example](missing.md)\n',
                     'Intro\n\n    [example](missing.md)\n\n    [another](missing2.md)\n',
                     '<!-- [old](missing.md) -->\n', '<!--\n[old](missing.md)\n-->\n']:
            with self.subTest(text=text):
                self.assertEqual(list(docs.local_targets(text + '[real](target.md)\n')), ['target.md'])

    def test_paragraph_continuation_links_remain_visible(self):
        self.assertEqual(list(docs.local_targets('Paragraph\n    [real](target.md)\n')), ['target.md'])

    def test_indented_list_paragraph_links_remain_visible(self):
        for text in ['- See documentation:\n\n    [guide](missing.md)\n',
                     '1. See documentation:\n\n    [guide](missing.md)\n',
                     '- Outer\n  - Inner\n\n      [guide](missing.md)\n']:
            with self.subTest(text=text):
                self.assertEqual(list(docs.local_targets(text)), ['missing.md'])
        self.assertEqual(list(docs.local_targets(
            '- Example:\n\n      [code](missing.md)\n')), [])

    def test_fences_allow_longer_matching_closers(self):
        for marker in ['`', '~']:
            for closing_length in [3, 4, 5]:
                text = marker * 3 + 'md\n[example](missing.md)\n' + marker * closing_length
                self.assertEqual(list(docs.local_targets(text + '\n[real](target.md)\n')), ['target.md'])
        self.assertEqual(list(docs.local_targets(
            '````md\n[example](missing.md)\n```\n[also code](missing2.md)\n')), [])

    def test_markdown_character_references_decode_before_url_parsing(self):
        for text in ['[target](target&#46;md)', '[target](target&period;md)',
                     '[target]: target&#x2e;md\n']:
            self.assertEqual(list(docs.local_targets(text)), ['target.md'])
        # HTMLParser already decodes HTML attributes once.
        self.assertEqual(list(docs.local_targets('<img src="a&amp;amp;b.png">')), ['a&amp;b.png'])

    def test_srcset_checks_each_local_candidate(self):
        text = '<picture><source SRCSET = "one.png 1x, two.png 2x"><img srcset="three.png 300w"></picture>'
        self.assertEqual(list(docs.local_targets(text)), ['one.png', 'two.png', 'three.png'])
        self.assertEqual(list(docs.local_targets('<img srcset="one.png, two.png">')), ['one.png', 'two.png'])
        self.assertEqual(list(docs.local_targets('<img srcset="data:image/png;base64,AAAA 1x, local.png 2x">')), ['local.png'])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / 'README.md').write_text('<source srcset="missing.png 1x">')
            self.assertIn('missing.png', docs.check_document(root, 'README.md')[0])


if __name__ == '__main__':
    unittest.main()
