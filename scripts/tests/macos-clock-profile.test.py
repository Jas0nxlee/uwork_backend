"""Execute the original clock driver's actual two prelaunch guards without invoking its run."""
import ast
import copy
from pathlib import Path
import unittest
SOURCE=Path(__file__).with_name('macos-clock-probe.py')
tree=ast.parse(SOURCE.read_text());run=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='run')
guards=run.body[:2];assert len(guards)==2 and all(isinstance(node,ast.Assert) for node in guards)
function=ast.FunctionDef(name='original_prelaunch_guards',args=ast.arguments(posonlyargs=[],args=[ast.arg(arg='profile')],kwonlyargs=[],kw_defaults=[],defaults=[]),body=copy.deepcopy(guards),decorator_list=[])
scope={};exec(compile(ast.fix_missing_locations(ast.Module(body=[function],type_ignores=[])),str(SOURCE),'exec'),scope)
check=scope['original_prelaunch_guards']
class OriginalProfileContract(unittest.TestCase):
    def test_next_arm64_consistency_name_satisfies_actual_original_guards(self):
        check('client-native-packaged-macos-clock-arm64-consistency-v1-20261020')
    def test_previously_failed_x64_startup_name_is_rejected_by_actual_original_guard(self):
        with self.assertRaises(AssertionError):check('client-native-packaged-macos-x64-startup-v1-20261020')
    def test_real_original_alnum_guard_rejects_path_punctuation_and_spaces(self):
        for tail in ['../other','with space','with.dot','/other']:
            with self.subTest(tail=tail),self.assertRaises(AssertionError):check('client-native-packaged-macos-clock-'+tail)
    def test_only_assertion_nodes_are_executed_before_any_fixture_or_os_side_effect(self):
        self.assertTrue(all(isinstance(node,ast.Assert) for node in function.body))
        self.assertNotIn('subprocess',ast.unparse(function));self.assertNotIn('mkdir',ast.unparse(function))
if __name__=='__main__':unittest.main()
