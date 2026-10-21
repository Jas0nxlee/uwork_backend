"""Contracts for the explicit filesystem-denied Native Memory test facility; no App."""

import ast, io, json, runpy, subprocess, tempfile, unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
NODE = "/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node"


class Contract(unittest.TestCase):
    def module(self):
        return runpy.run_path(
            str(ROOT / "scripts/tests/mac-arm64-memory-filesystem-denied-probe.py")
        )

    def test_actual_fixture_env_and_message_shapes_no_title_false_positive(self):
        m = self.module()
        original = runpy.run_path(str(ROOT / "scripts/tests/native-g04k-cdp-probe.py"))
        captured = []

        def popen(command, **kw):
            captured.append(kw["env"])
            return SimpleNamespace(
                stdin=io.StringIO(), stdout=io.StringIO(), stderr=io.StringIO()
            )

        with patch("subprocess.Popen", popen), patch("threading.Thread"):
            original["Fixture"](
                m["PROFILE"],
                Path("/owned/home"),
                Path("/owned/tmp"),
                mode="experience",
                packaged_manifest=Path("/owned/manifest"),
            )
        code = """import assert from'node:assert/strict';import{validateDeniedMemoryProfile,projectDeniedMemoryRequest,deriveDeniedMemoryFixture,DENIED_LABEL}from'./scripts/fixtures/mac-arm64-memory-filesystem-denied-derived.mjs';import{readFileSync}from'node:fs';let s='';for await(const c of process.stdin)s+=c;const env=JSON.parse(s);validateDeniedMemoryProfile(env.UWORK_NATIVE_FIXTURE_NAME,env);assert.throws(()=>validateDeniedMemoryProfile(env.UWORK_NATIVE_FIXTURE_NAME,{...env,UWORK_NATIVE_PRIMARY_LOGIN:'controlled'}));assert.throws(()=>validateDeniedMemoryProfile(env.UWORK_NATIVE_FIXTURE_NAME,{...env,UWORK_NATIVE_CONFIGURATION_WITNESS:undefined}));
const body='UWORK_NATIVE_MEMORY_BODY_20261021',project=r=>projectDeniedMemoryRequest(r,DENIED_LABEL,body);const request={stream:true,messages:[{role:'user',content:DENIED_LABEL},{role:'user',content:[{type:'text',text:'context '+body}]}]};assert.equal(project(request).bodyEscaped,true);assert.equal(project({...request,messages:[{role:'user',content:[{type:'text',text:'context '+body},{type:'text',text:DENIED_LABEL}]}]}).bodyEscaped,true);assert.equal(project({...request,messages:[{role:'system',content:body},request.messages[0]]}).bodyEscaped,true);assert.equal(project({...request,stream:false}).bodyEscaped,false);assert.equal(project({...request,messages:[request.messages[0]]}).bodyEscaped,false);assert.equal(JSON.stringify(project(request)).includes(body),false);const fixture=deriveDeniedMemoryFixture(readFileSync('scripts/fixtures/client-native-enterprise.mjs','utf8'));assert(fixture.includes("await configure('security',{allowFilesystem:false})"));assert(fixture.indexOf("await configure('security',{allowFilesystem:false})")<fixture.indexOf('console.log(JSON.stringify({ event: "ready"'));assert(fixture.includes('MEMORY_INDEX_BODY_ESCAPED_FILESYSTEM_FALSE'));assert(fixture.includes('native-packaged-macos-arm64-project-memory-runtime.mjs'));assert(!fixture.includes('native-packaged-macos-arm64-asar-integrity-runtime.mjs')); console.log(JSON.stringify({fixture,actualFixtureEnv:true}));"""
        result = subprocess.run(
            [NODE, "--input-type=module", "-e", code],
            cwd=ROOT,
            input=json.dumps(captured[0]),
            text=True,
            capture_output=True,
            timeout=12,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        fixture = json.loads(result.stdout)["fixture"]
        check = subprocess.run(
            [NODE, "--check", "--input-type=module"],
            input=fixture,
            text=True,
            capture_output=True,
            timeout=10,
        )
        self.assertEqual(check.returncode, 0, check.stderr)

    def test_actual_namespace_globals_and_failfast_slice_preserves_finally(self):
        m = self.module()
        s = m["deriveDeniedMemoryProbe"](m["BASE"].read_text())
        ns = m["create_denied_namespace"](s, m["MemoryCaseBudget"]())
        m["verify_globals"](ns)
        self.assertIs(ns["run"].__globals__, ns)
        self.assertNotIn("f.command('memberSeat', value=False)", s)
        self.assertIn("MEMORY_INDEX_BODY_ESCAPED_FILESYSTEM_FALSE", s)
        old = m["M"]["deriveMemoryProbe"](m["BASE"].read_text())
        self.assertEqual(
            s.split("    finally:\n        MEMORY_BUDGET.begin_cleanup()", 1)[1],
            old.split("    finally:\n        MEMORY_BUDGET.begin_cleanup()", 1)[1],
        )
        self.assertEqual(s.count("text=DENIED_LABEL"), 1)
        self.assertNotIn("MEMORY_ACTIVE_BUDGET", s)
        tree = ast.parse(s)
        f = next(
            n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "run"
        )
        ns.update(
            f=SimpleNamespace(
                command=lambda *a, **kw: {"facts": {"bodyEscaped": True}}
            ),
            observations={},
            bridge=SimpleNamespace(
                evaluate=lambda _: self.fail("DOM must not run after exposure")
            ),
            memory_work_end=m["time"].monotonic() + 10,
        )
        blocks = [
            next(
                n
                for n in ast.walk(f)
                if isinstance(n, ast.FunctionDef) and n.name == name
            )
            for name in ["deny_status", "denied_until"]
        ]
        exec(
            compile(ast.Module(body=blocks, type_ignores=[]), "actual-poll", "exec"), ns
        )
        with tempfile.TemporaryDirectory() as folder:
            ns["evidence"] = Path(folder)
            with self.assertRaisesRegex(
                AssertionError, "MEMORY_INDEX_BODY_ESCAPED_FILESYSTEM_FALSE"
            ):
                ns["denied_until"]("unused", "test", 1)
            self.assertTrue(
                (Path(folder) / "memory-filesystem-failure-observation.json").exists()
            )

    def test_actual_packaged_main_block_never_reads_dev_out_and_rejects_missing_entry(
        self,
    ):
        code = r"""import assert from'node:assert/strict';import{readFile,mkdtemp,mkdir,writeFile,rm}from'node:fs/promises';import{join,resolve}from'node:path';import{tmpdir}from'node:os';import{pathToFileURL}from'node:url';import{createHash}from'node:crypto';import{deriveDeniedMemoryFixture}from'./scripts/fixtures/mac-arm64-memory-filesystem-denied-derived.mjs';
const client=resolve('clients/uwork'),source=deriveDeniedMemoryFixture(await readFile('scripts/fixtures/client-native-enterprise.mjs','utf8'));const start=source.indexOf('// PACKAGED_MAIN_READONLY_BEGIN'),end=source.indexOf('// PACKAGED_MAIN_READONLY_END');assert(start>=0&&end>start,'actual derived readonly block required');const block=source.slice(start,end);assert(!block.includes('packages/desktop/out'));assert(!source.includes('const outSnapshot = await copyNativeOutSnapshot('));
const asar=await import(pathToFileURL(join(client,'node_modules/@electron/asar/lib/asar.js')).href),folder=await mkdtemp(join(tmpdir(),'uw-denied-main-contract-'));try{const src=join(folder,'src');await mkdir(join(src,'out/main'),{recursive:true});const bytes=Buffer.from('ownedPackagedMain();\n');await writeFile(join(src,'out/main/index.js'),bytes);const app=join(folder,'owned.app');await mkdir(join(app,'Contents/Resources'),{recursive:true});await asar.createPackage(src,join(app,'Contents/Resources/app.asar'));let devReads=0;const safeRead=async path=>{if(String(path).includes('desktop/out')){devReads++;throw Error('FAULT_DEV_OUT_READ')}return readFile(path)};const execute=new (Object.getPrototypeOf(async function(){}).constructor)('packagedRuntime','client','join','pathToFileURL','createHash','readFile','writeFile','evidence',block+';return mainEntrySha256;');const evidence=join(folder,'evidence');await mkdir(evidence);const hash=await execute({appPath:app},client,join,pathToFileURL,createHash,safeRead,writeFile,evidence);assert.equal(hash,createHash('sha256').update(bytes).digest('hex'));assert.equal(devReads,0);const receipt=JSON.parse(await readFile(join(evidence,'packaged-main-readonly.json'),'utf8'));assert.equal(receipt.noDevelopmentOutCopied,true);assert.equal(receipt.packagedActualMain,true);assert.equal(receipt.mainEntrySha256,hash);await assert.rejects(()=>execute(null,client,join,pathToFileURL,createHash,safeRead,writeFile,evidence));const badApp=join(folder,'bad.app');await mkdir(join(badApp,'Contents/Resources'),{recursive:true});const badSrc=join(folder,'badsrc');await mkdir(badSrc);await writeFile(join(badSrc,'wrong.js'),'wrong');await asar.createPackage(badSrc,join(badApp,'Contents/Resources/app.asar'));await assert.rejects(()=>execute({appPath:badApp},client,join,pathToFileURL,createHash,safeRead,writeFile,evidence));assert.equal(devReads,0);}finally{await rm(folder,{recursive:true,force:true})}
"""
        result = subprocess.run(
            [NODE, "--input-type=module", "-e", code],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=12,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_actual_status_branch_passes_valid_phases_to_original_capture(self):
        code = r"""import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{parse}from'acorn';import{deriveDeniedMemoryFixture}from'./scripts/fixtures/mac-arm64-memory-filesystem-denied-derived.mjs';import{MAC_STAGE_SELECTS,captureMacBackendStage,assertMacOtherActorAccountingUnchanged,macStageDigest}from'./scripts/fixtures/mac-backend-stage-snapshot.mjs';
const source=deriveDeniedMemoryFixture(await readFile('scripts/fixtures/client-native-enterprise.mjs','utf8'));let branch;const walk=n=>{if(!n||typeof n!=='object')return;if(n.type==='IfStatement'&&source.slice(n.test.start,n.test.end).includes("c.op==='memoryFilesystemStatus'"))branch=n.consequent;for(const [k,v]of Object.entries(n)){if(k==='parent')continue;if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v)}};walk(parse(source,{ecmaVersion:'latest',sourceType:'module'}));assert(branch,'actual status branch');const body=source.slice(branch.start+1,branch.end-1);const db={all:(sql,...args)=>sql===MAC_STAGE_SELECTS.member?[{tenant_id:args[0],user_id:args[1],role:'member',department_id:null,status:'active',seat:1}]:[]};const ctx={authority:'owned-fixture-existing-db',phase:'warm',sampledAt:Date.now(),actors:[{label:'current',tenantId:'t',userId:'a'},{label:'other',tenantId:'t',userId:'b'}]};const memoryPrevious={stage:'warm',snapshot:captureMacBackendStage(db,ctx)},phases=[],logged=[];const complete=Symbol('phase accepted, downstream accounting not under this contract');const bindings={c:null,packagedRuntime:{},memoryPrevious,deniedMemoryObserverFailed:false,deniedMemoryExposure:null,api:async(path,method,payload)=>path.includes('/configurations/')?{published:{allowFilesystem:false},version:1,revision:2}:{allowed:payload.action==='execution',security:{allowFilesystem:false},tenantId:'t'},p:'/api/tenants/t',identity:'synthetic-contract-only',owner:{tenantId:'t'},member:{id:'a'},app:{services:{db}},captureMacBackendStage:(d,c)=>{const snapshot=captureMacBackendStage(d,c);phases.push(snapshot.phase);if(c.phase==='memory-filesystem-complete')throw complete;return snapshot},assertMacOtherActorAccountingUnchanged,macStageDigest,modelCalls:4,modelRequests:[],memoryIngress:{read:()=>4},console:{log:text=>logged.push(JSON.parse(text))}};const invoke=new(Object.getPrototypeOf(async function(){}).constructor)(...Object.keys(bindings),body);bindings.c={op:'memoryFilesystemStatus'};await invoke(...Object.values(bindings));assert.equal(logged.length,1);assert.equal(logged[0].status,'done');assert.equal(logged[0].facts.snapshot.phase,'memory-filesystem-status');bindings.c={op:'memoryFilesystemComplete'};await assert.rejects(()=>invoke(...Object.values(bindings)),error=>error===complete);assert.deepEqual(phases,['memory-filesystem-status','memory-filesystem-complete']);
"""
        result = subprocess.run(
            [NODE, "--input-type=module", "-e", code],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=12,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_actual_terminal_hashing_block_uses_real_derived_namespace(self):
        m = self.module()
        s = m["deriveDeniedMemoryProbe"](m["BASE"].read_text())
        ns = m["create_denied_namespace"](s, m["MemoryCaseBudget"]())
        tree = ast.parse(s)
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / "MEMORY.md"
            file.write_bytes((ns["BODY"] + "\n").encode())
            ns["memory_file"] = file
            stmt = next(
                n
                for n in ast.walk(tree)
                if isinstance(n, ast.Assign)
                and any(
                    isinstance(t, ast.Name) and t.id == "file_sha" for t in n.targets
                )
            )
            exec(
                compile(
                    ast.Module(body=[stmt], type_ignores=[]), "actual-file-hash", "exec"
                ),
                ns,
            )
            self.assertEqual(
                ns["file_sha"],
                "3b7960cf2cdb97a9d8d097fcb4c3ca71f19a45eea0a86be98b3343b5ab063637",
            )


if __name__ == "__main__":
    unittest.main()
