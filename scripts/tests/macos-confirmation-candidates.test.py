"""Pure fixture regression for the owned NSAlert tree shape; never calls native AX."""
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest
import os

PROBE = runpy.run_path(str(Path(__file__).with_name('macos-confirmation-probe.py')))


class CandidateTests(unittest.TestCase):
    def fixture(self):
        # v3 observed AXSheets=[] while an AXSheet was an AXStandardWindow child.
        window = {'role': 'AXWindow', 'subrole': 'AXStandardWindow'}
        sheet = {'role': 'AXSheet', 'depth': 1}
        other = {'role': 'AXSheet', 'depth': 1}
        first = [(2, sheet), (3, {'role': 'AXButton', 'title': '取消'})]
        second = [(4, other), (5, {'role': 'AXButton', 'title': '打开文件夹'})]
        rows = {1: [(1, window), *first, *second], 2: first, 4: second,
                6: [(6, {'role': 'AXWindow', 'subrole': 'AXDialog'})]}
        calls = []
        def collect(ref, **limits):
            self.assertEqual(limits, {'max_depth': 12, 'max_nodes': 400})
            calls.append(ref)
            return rows[ref]
        return {'describe': lambda ref: rows[ref][0][1], 'collect': collect}, calls

    def test_observed_child_sheets_are_discovered_and_collected_separately(self):
        ax, calls = self.fixture()
        retained = []
        found, projection = PROBE['collect_native_confirmation_candidates'](ax, [1], retained)
        self.assertEqual([ref for ref, _ in found], [2, 4])
        self.assertEqual(calls, [1, 2, 4])
        self.assertEqual(len(projection), 1)
        self.assertEqual([node for node, _ in found[0][1]], [2, 3])
        self.assertEqual([node for node, _ in found[1][1]], [4, 5])
        self.assertEqual(len(retained), 3)

    def test_property_and_child_duplicate_refs_are_unique(self):
        ax, calls = self.fixture()
        found, _ = PROBE['collect_native_confirmation_candidates'](ax, [1, 2, 4, 2], [])
        self.assertEqual([ref for ref, _ in found], [2, 4])
        self.assertEqual(calls.count(2), 1)
        self.assertEqual(calls.count(4), 1)

    def test_top_level_native_dialog_retains_original_contract(self):
        ax, _ = self.fixture()
        found, _ = PROBE['collect_native_confirmation_candidates'](ax, [6], [])
        self.assertEqual([ref for ref, _ in found], [6])

    def test_standard_window_is_not_a_native_dialog(self):
        ax = {'describe': lambda _: {'role': 'AXWindow', 'subrole': 'AXStandardWindow'},
              'collect': lambda *_args, **_kwargs: [(1, {'role': 'AXWindow', 'subrole': 'AXStandardWindow'})]}
        found, _ = PROBE['collect_native_confirmation_candidates'](ax, [1], [])
        self.assertEqual(found, [])


class ExecutableCensusTests(unittest.TestCase):
    def test_file_opener_is_not_an_executable_mapping(self):
        # Real lsof: merely opening the target file makes the old -t query list us.
        with tempfile.TemporaryDirectory(prefix='uwork-census-contract-') as directory:
            path = str(Path(directory) / 'owned-executable-candidate')
            Path(path).write_bytes(b'owned readonly file; not executed')
            with open(path, 'rb'):
                found = subprocess.run(['lsof', '-t', path], capture_output=True, text=True, check=True)
                self.assertIn(str(os.getpid()), found.stdout.split())
                mapped = subprocess.run(['lsof', '-nP', '-a', '-p', str(os.getpid()), '-d', 'txt', '-Fn'], capture_output=True, text=True, check=True)
                rows = PROBE['classify_executable_census']([{'pid': os.getpid(),
                    'ppidBirthCommand': 'owned Python test file reader', 'mappedTxt': mapped.stdout}], path, -1)
                self.assertFalse(rows[0]['mapsExactExecutableTxt'])
                self.assertEqual(rows[0]['classification'], 'not-exact-executable-txt')

    def test_unknown_exact_mapping_stays_unresolved_even_if_title_looks_like_cli(self):
        rows = PROBE['classify_executable_census']([
            {'pid': 20, 'mappedTxt': 'p20\nn/owned/Main\n', 'ppidBirthCommand': 'UWork'},
            {'pid': 21, 'mappedTxt': 'p21\nn/owned/Main\n', 'ppidBirthCommand': 'cli /glm/zcode.cjs --type=utility'},
        ], '/owned/Main', 20)
        self.assertEqual([row['classification'] for row in rows], ['original-main', 'unresolved-executable-mapping'])
        self.assertEqual([row['pid'] for row in rows if row['mapsExactExecutableTxt']], [20, 21])

    def test_mapping_requires_exact_path_including_name_suffix(self):
        rows = PROBE['classify_executable_census']([
            {'pid': 21, 'mappedTxt': 'p21\nn/owned/Main Helper\n', 'ppidBirthCommand': 'UWork'},
            {'pid': 22, 'mappedTxt': '', 'ppidBirthCommand': ''},
        ], '/owned/Main', 20)
        self.assertFalse(any(row['mapsExactExecutableTxt'] for row in rows))


if __name__ == '__main__':
    unittest.main()
