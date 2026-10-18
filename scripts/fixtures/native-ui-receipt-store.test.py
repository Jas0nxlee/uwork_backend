import concurrent.futures
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location("native_ui_receipt_store",Path(__file__).with_name("native-ui-receipt-store.py"))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

def write(root,epoch,phase,value):
    fd,name=module.reserve_result_file(str(Path(root).resolve(strict=True)),epoch,phase)
    with os.fdopen(fd,"w") as stream:json.dump(value,stream)
    return name

class Contracts(unittest.TestCase):
    def test_all_repeatable_observations_write_twice_without_overwrite(self):
        with tempfile.TemporaryDirectory(prefix="uwork-ui-observation-contract-") as root:
            for phase in sorted(module.OBSERVATIONS):
                first=write(root,1,phase,{"passed":True,"read":1})
                before=(Path(root)/first).read_bytes()
                second=write(root,1,phase,{"passed":True,"read":2})
                self.assertNotEqual(first,second)
                self.assertEqual((Path(root)/first).read_bytes(),before)
                self.assertEqual(json.loads((Path(root)/second).read_text())["read"],2)
                self.assertEqual((Path(root)/second).stat().st_mode&0o777,0o600)

    def test_epoch_observations_have_independent_exclusive_sequences(self):
        with tempfile.TemporaryDirectory(prefix="uwork-ui-observation-contract-") as root:
            names=[write(root,epoch,"observe",{"read":epoch}) for epoch in (1,2,3)]
            self.assertEqual(len(set(names)),3)
            for name in names:self.assertTrue(name.endswith("0001.json"))

    def test_concurrent_readonly_outputs_never_share_or_overwrite_a_file(self):
        with tempfile.TemporaryDirectory(prefix="uwork-ui-observation-contract-") as root:
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                names=list(pool.map(lambda n:write(root,1,"first_run_observe",{"read":n}),range(8)))
            self.assertEqual(len(set(names)),8)
            self.assertEqual({json.loads((Path(root)/name).read_text())["read"] for name in names},set(range(8)))

    def test_every_business_output_is_still_once_and_unchanged_after_rejection(self):
        with tempfile.TemporaryDirectory(prefix="uwork-ui-observation-contract-") as root:
            for phase in sorted(module.BUSINESS):
                name=write(root,1,phase,{"once":True});before=(Path(root)/name).read_bytes()
                with self.assertRaisesRegex(ValueError,"^PRIMARY_UI_OUTPUT_REJECTED$"):write(root,1,phase,{"once":False})
                self.assertEqual((Path(root)/name).read_bytes(),before)

    def test_invalid_scope_and_symlink_fail_without_following_target(self):
        with tempfile.TemporaryDirectory(prefix="uwork-ui-observation-contract-") as root:
            for epoch,phase in ((True,"observe"),(4,"observe"),(2,"first_run_observe"),(3,"preworkspace"),(1,"../escape"),(1,"arbitrary_rpc")):
                with self.assertRaisesRegex(ValueError,"^PRIMARY_UI_OUTPUT_REJECTED$"):write(root,epoch,phase,{})
            target=Path(root)/"ui-e1-observe-observation-0001.json"
            target.symlink_to("/never-open-ui-observation-target")
            with self.assertRaisesRegex(ValueError,"^PRIMARY_UI_OUTPUT_REJECTED$"):write(root,1,"observe",{})
            self.assertTrue(target.is_symlink())
            for directory in ('relative', str(Path(root))+'/../escape'):
                with self.assertRaisesRegex(ValueError,'^PRIMARY_UI_OUTPUT_REJECTED$'):
                    module.reserve_result_file(directory,1,'observe')

    def test_numbering_is_bounded_and_directory_symlinks_are_not_followed(self):
        with tempfile.TemporaryDirectory(prefix="uwork-ui-observation-contract-") as root:
            names=[write(root,1,"observe",{"read":n}) for n in range(128)]
            before=(Path(root)/names[-1]).read_bytes()
            with self.assertRaisesRegex(ValueError,"^PRIMARY_UI_OUTPUT_REJECTED$"):write(root,1,"observe",{})
            self.assertEqual((Path(root)/names[-1]).read_bytes(),before)
            owned=Path(root)/"owned";owned.mkdir(mode=0o700)
            alias=Path(root)/"alias";alias.symlink_to(owned,target_is_directory=True)
            with self.assertRaisesRegex(ValueError,"^PRIMARY_UI_OUTPUT_REJECTED$"):
                module.reserve_result_file(str(Path(root).resolve(strict=True)/"alias"),1,"observe")
            self.assertEqual(list(owned.iterdir()),[])


if __name__=="__main__":unittest.main()
