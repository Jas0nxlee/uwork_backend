"""Only parser/geometry/one-anchor fixture contracts; never starts Docker, PTY or GUI."""
import hashlib
from pathlib import Path
import runpy
import tempfile
import unittest

HERE = Path(__file__).parent
FIT = runpy.run_path(str(HERE / 'linux-terminal-fit.py'))
DERIVE = runpy.run_path(str(HERE / 'linux-wire-protocol-derive.py'))


class Contracts(unittest.TestCase):
    def test_owned_stty_projection_requires_dimensions_and_same_scope(self):
        value = FIT['parse_shell_proof']('37 91\n/work/project\n/dev/pts/3\n123\n')
        self.assertEqual(value, {'rows': 37, 'cols': 91, 'cwd': '/work/project', 'tty': '/dev/pts/3', 'shellPid': 123})

    def test_wrong_dimensions_identity_or_extra_body_is_rejected(self):
        for value in ['0 91\n/work/project\n/dev/pts/3\n123',
                      '-1 91\n/work/project\n/dev/pts/3\n123',
                      '37 91\n/foreign\n/dev/pts/3\n123',
                      '37 91\n/work/project\nnot a tty\n123',
                      '37 91\n/work/project\n/dev/pts/3\n0',
                      '37 91\n/work/project\n/dev/pts/3\n123\nextra']:
            with self.subTest(value=value), self.assertRaises((AssertionError, ValueError)):
                FIT['parse_shell_proof'](value)

    def test_width_always_changes_materially_without_collapse(self):
        for width in [900, 950, 1099, 1100, 1200, 1400]:
            result = FIT['resized_geometry']({'WIDTH': width, 'HEIGHT': 800})
            self.assertGreaterEqual(result['WIDTH'], 900)
            self.assertEqual(abs(result['WIDTH'] - width), 180)
            self.assertLessEqual(result['WIDTH'], 1440)
            self.assertEqual(result['HEIGHT'], 720)

    def test_invalid_geometry_is_rejected(self):
        with self.assertRaises(AssertionError): FIT['resized_geometry']({'WIDTH': 0, 'HEIGHT': 800})

    def test_actual_original_protocol_has_one_raw_label_derivation_and_no_other_changes(self):
        source = HERE / 'linux-desktop/protocol.py'
        before = source.read_bytes()
        with tempfile.TemporaryDirectory(prefix='uwork-wire-protocol-pure-') as directory:
            output = Path(directory) / 'protocol.py'
            result = DERIVE['derive_protocol'](source, output)
            derived = output.read_text()
            self.assertEqual(derived.count('&wireLabel=中文'), 1)
            self.assertEqual(derived.replace(DERIVE['ANCHOR'] + DERIVE['SUFFIX'], DERIVE['ANCHOR'], 1), before.decode())
            self.assertTrue(result['onlyOneAnchorChanged'] and result['sourceUnchanged'])
            self.assertFalse(result['extraQueryHasBusinessMeaning'])
            self.assertEqual(result['originalSha256'], hashlib.sha256(before).hexdigest())
            compile(derived, str(output), 'exec')
        self.assertEqual(source.read_bytes(), before)

    def test_missing_or_duplicate_anchor_never_writes_derivative(self):
        with tempfile.TemporaryDirectory(prefix='uwork-wire-protocol-negative-') as directory:
            source, output = Path(directory) / 'source.py', Path(directory) / 'protocol.py'
            for body in ['unrelated', DERIVE['ANCHOR'] + '\n' + DERIVE['ANCHOR']]:
                source.write_text(body)
                with self.assertRaises(AssertionError): DERIVE['derive_protocol'](source, output)
                self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
