"""Actual manifest negative fixture contracts only; no App, server, or model sender."""

import ast, hashlib, io, json, pathlib, runpy, shlex, subprocess, tempfile, time, unittest
from types import SimpleNamespace
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
NODE = "/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node"


class Contract(unittest.TestCase):
    def module(self):
        return runpy.run_path(
            str(ROOT / "scripts/tests/mac-memory-manifest-filesystem-denied-probe.py")
        )

    def test_actual_fixture_launch_env_and_any_request_text_observer(self):
        m = self.module()
        native = runpy.run_path(str(ROOT / "scripts/tests/native-g04k-cdp-probe.py"))
        env = []

        def popen(*a, **kw):
            env.append(kw["env"])
            return SimpleNamespace(
                stdin=io.StringIO(), stdout=io.StringIO(), stderr=io.StringIO()
            )

        with patch("subprocess.Popen", popen), patch("threading.Thread"):
            native["Fixture"](
                m["PROFILE"],
                pathlib.Path("/owned/home"),
                pathlib.Path("/owned/tmp"),
                mode="experience",
                packaged_manifest=pathlib.Path("/owned/manifest"),
            )
        code = """import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{validateManifestProfile,deriveManifestFixture,projectManifestRequest,MANIFEST_MARKER,MANIFEST_PROMPT,TOPIC_TEXT}from'./scripts/fixtures/mac-memory-manifest-filesystem-denied.mjs';let s='';for await(const c of process.stdin)s+=c;const env=JSON.parse(s);validateManifestProfile(env.UWORK_NATIVE_FIXTURE_NAME,env);assert.throws(()=>validateManifestProfile(env.UWORK_NATIVE_FIXTURE_NAME,{...env,UWORK_NATIVE_PRIMARY_LOGIN:'controlled'}));assert.throws(()=>validateManifestProfile(env.UWORK_NATIVE_FIXTURE_NAME,{...env,UWORK_NATIVE_CONFIGURATION_WITNESS:undefined}));assert(!MANIFEST_PROMPT.includes(MANIFEST_MARKER));assert(MANIFEST_PROMPT.trim().split(/\\s+/).length>=3);assert.equal(TOPIC_TEXT.split(MANIFEST_MARKER).length,2);for(const request of[{stream:false,messages:[{role:'user',content:MANIFEST_MARKER}]},{stream:true,messages:[{role:'system',content:[{type:'text',text:MANIFEST_MARKER}]}]},{other:MANIFEST_MARKER}])assert.equal(projectManifestRequest(request,MANIFEST_MARKER).metadataEscaped,true);assert.equal(projectManifestRequest({stream:false,messages:[{role:'user',content:MANIFEST_PROMPT}]},MANIFEST_MARKER).metadataEscaped,false);assert(!JSON.stringify(projectManifestRequest({x:MANIFEST_MARKER},MANIFEST_MARKER)).includes(MANIFEST_MARKER));const fixture=deriveManifestFixture(readFileSync('scripts/fixtures/client-native-enterprise.mjs','utf8'));assert(fixture.includes('contextWindow: 500000'));assert(fixture.includes('memoryModel.data.supportsTools!==true'));assert(fixture.includes("await configure('security',{allowFilesystem:false})"));assert(!fixture.includes('const outSnapshot = await copyNativeOutSnapshot('));console.log(JSON.stringify({topicText:TOPIC_TEXT,fixture}));"""
        p = subprocess.run(
            [NODE, "--input-type=module", "-e", code],
            input=json.dumps(env[0]),
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=12,
        )
        self.assertEqual(p.returncode, 0, p.stderr)
        out = json.loads(p.stdout)
        self.assertEqual(out["topicText"], m["TOPIC_TEXT"])
        c = subprocess.run(
            [NODE, "--check", "--input-type=module"],
            input=out["fixture"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(c.returncode, 0, c.stderr)

    def test_actual_namespace_seed_statement_and_failfast_callback(self):
        m = self.module()
        source = m["deriveManifestProbe"](m["BASE"].read_text())
        ns = m["create_manifest_namespace"](source, m["MemoryCaseBudget"]())
        m["verify_globals"](ns)
        self.assertIs(ns["run"].__globals__, ns)
        self.assertNotIn("f.command('memberSeat', value=False)", source)
        self.assertIn("MEMORY_MANIFEST_METADATA_ESCAPED_FILESYSTEM_FALSE", source)
        previous = m["D"]["deriveDeniedMemoryProbe"](m["BASE"].read_text())
        tail = "    finally:\n        MEMORY_BUDGET.begin_cleanup()"
        self.assertIn("safe_native_cleanup(f=f,bridge=bridge,guard=guard", source)
        self.assertNotIn("f.child.wait(timeout=30)", source)
        tree = ast.parse(source)
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp).resolve() / m["PROFILE"]
            topic = (
                root
                / "data/.uwork/cli/memories/projects/owned/memory/owned-manifest-topic.md"
            )
            root.mkdir()
            p = subprocess.run(
                shlex.split(m["manifest_seed_command"](root, topic)),
                capture_output=True,
                text=True,
                timeout=10,
            )
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertFalse((topic.parent / "MEMORY.md").exists())
            self.assertEqual(topic.read_text(), m["TOPIC_TEXT"])
            ns["memory_file"] = topic
            statement = next(
                n
                for n in ast.walk(tree)
                if isinstance(n, ast.Assign)
                and any(
                    isinstance(t, ast.Name) and t.id == "file_sha" for t in n.targets
                )
            )
            exec(
                compile(
                    ast.Module(body=[statement], type_ignores=[]),
                    "actual-seed-sha",
                    "exec",
                ),
                ns,
            )
            self.assertEqual(
                ns["file_sha"], hashlib.sha256(m["TOPIC_TEXT"].encode()).hexdigest()
            )
            attest = "import{attestManifestTopic}from'./scripts/fixtures/mac-memory-manifest-filesystem-denied.mjs';console.log(JSON.stringify(await attestManifestTopic(JSON.parse(process.argv[1]))));"
            actual = subprocess.run(
                [
                    NODE,
                    "--input-type=module",
                    "-e",
                    attest,
                    json.dumps(
                        {
                            "caseRoot": str(root),
                            "indexPath": str(topic.parent / "MEMORY.md"),
                        }
                    ),
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                timeout=10,
            )
            self.assertEqual(actual.returncode, 0, actual.stderr)
            self.assertEqual(json.loads(actual.stdout)["sha256"], ns["file_sha"])
            again = subprocess.run(
                shlex.split(m["manifest_seed_command"](root, topic)),
                capture_output=True,
                text=True,
                timeout=10,
            )
            self.assertNotEqual(again.returncode, 0)
            ns.update(
                f=SimpleNamespace(
                    command=lambda *a, **k: {"facts": {"metadataEscaped": True}}
                ),
                observations={},
                evidence=pathlib.Path(tmp),
                bridge=SimpleNamespace(
                    evaluate=lambda _: self.fail("no DOM read after leak")
                ),
                memory_work_end=time.monotonic() + 10,
            )
            blocks = [
                next(
                    n
                    for n in ast.walk(tree)
                    if isinstance(n, ast.FunctionDef) and n.name == name
                )
                for name in ["deny_status", "denied_until"]
            ]
            exec(
                compile(
                    ast.Module(body=blocks, type_ignores=[]), "actual-failfast", "exec"
                ),
                ns,
            )
            with self.assertRaisesRegex(
                AssertionError, "MEMORY_MANIFEST_METADATA_ESCAPED_FILESYSTEM_FALSE"
            ):
                ns["denied_until"]("unused", "leak", 1)

    def test_actual_terminal_insert_and_file_validation_use_single_line_transport(self):
        m = self.module()
        source = m["deriveManifestProbe"](m["BASE"].read_text())
        tree = ast.parse(source)
        run = next(
            n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "run"
        )
        body = next(n for n in run.body if isinstance(n, ast.Try) and n.finalbody).body
        start = next(
            i
            for i, n in enumerate(body)
            if isinstance(n, ast.Expr)
            and isinstance(n.value, ast.Call)
            and isinstance(n.value.func, ast.Attribute)
            and n.value.func.attr == "raw_cdp"
            and any(
                isinstance(k.value, ast.Call)
                and isinstance(k.value.func, ast.Name)
                and k.value.func.id == "manifest_seed_command"
                for k in n.value.keywords
            )
        )
        end = next(
            i
            for i in range(start, len(body))
            if isinstance(body[i], ast.Assign)
            and any(
                isinstance(t, ast.Name) and t.id == "file_sha" for t in body[i].targets
            )
        )
        block = compile(
            ast.Module(body=body[start : end + 1], type_ignores=[]),
            "actual-typed-seed-and-validation",
            "exec",
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp).resolve()
            index = root / "data/.uwork/cli/memories/projects/owned/memory/MEMORY.md"
            topic = index.parent / m["TOPIC_NAME"]
            commands = []

            def raw_cdp(method, **kwargs):
                if method == "Input.insertText":
                    text = kwargs["text"]
                    self.assertNotIn(
                        "\n", text, "typed shell transport must be one line"
                    )
                    self.assertNotIn("\r", text)
                    commands.append(text)
                elif kwargs["type"] == "keyDown":
                    result = subprocess.run(
                        ["/bin/zsh", "-fc", commands[-1]],
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)

            ns = m["create_manifest_namespace"](source, m["MemoryCaseBudget"]())
            ns.update(
                root=root,
                memory_file=topic,
                memory_index=index,
                memory_work_end=time.monotonic() + 10,
                bridge=SimpleNamespace(raw_cdp=raw_cdp),
            )
            exec(block, ns)
            self.assertEqual(len(commands), 1)
            self.assertEqual(topic.read_bytes(), m["TOPIC_TEXT"].encode())
            self.assertEqual(
                ns["file_sha"], hashlib.sha256(topic.read_bytes()).hexdigest()
            )

    def test_actual_manifest_finally_original180_escapes_new160_and180_persist(self):
        import threading, types

        m = self.module()
        original = m["deriveManifestProbe"]
        old_deriver = types.FunctionType(
            original.__code__,
            {
                **original.__globals__,
                "S": {"derive_safe_native_cleanup": lambda s, b: s},
            },
        )
        old = old_deriver(m["BASE"].read_text())
        new = original(m["BASE"].read_text())

        def final(source):
            f = next(
                n
                for n in ast.parse(source).body
                if isinstance(n, ast.FunctionDef) and n.name == "run"
            )
            t = next(n for n in f.body if isinstance(n, ast.Try) and n.finalbody)
            return compile(
                ast.Module(body=t.finalbody, type_ignores=[]),
                "actual-manifest-finally",
                "exec",
            )

        def scenario(folder, now):
            calls = []
            budget = m["MemoryCaseBudget"](now=lambda: 0)
            budget.now = lambda: float(now)

            class Child:
                returncode = None

                def __init__(self):
                    self.stdin = SimpleNamespace(close=lambda: calls.append("eof"))

                def poll(self):
                    return self.returncode

                def terminate(self):
                    calls.append("terminate")
                    self.returncode = 0

                def kill(self):
                    self.returncode = -9

                def wait(self, timeout=None):
                    calls.append("wait")
                    return self.returncode

            f = SimpleNamespace(
                child=Child(),
                lock=threading.Lock(),
                events=[],
                command=lambda *a, **k: None,
                wait_event=lambda *a: None,
                send=lambda *a: None,
            )
            guard = SimpleNamespace(
                child=Child(),
                close=lambda: calls.append("restore")
                or {"protocolRestored": True, "usesSystemClipboard": False},
                command=lambda *a: None,
                read=lambda: None,
            )
            budget.bind_fixture(f)
            budget.bind_guard(guard)
            obs = {}
            ns = m["create_manifest_namespace"](new, budget)
            ns.update(
                f=f,
                bridge=None,
                guard=guard,
                OLD={"owned_processes": lambda *a: []},
                meta={},
                known=set(),
                errors=[],
                observations=obs,
                facts={"status": "passed", "observations": obs},
                evidence=folder,
                memory_case_end=180,
            )
            return ns, calls

        with tempfile.TemporaryDirectory() as tmp:
            ns, calls = scenario(pathlib.Path(tmp), 180)
            with self.assertRaises(AssertionError):
                exec(final(old), ns)
            self.assertIn("terminate", calls)
            self.assertNotIn("restore", calls)
            self.assertFalse((pathlib.Path(tmp) / "result.json").exists())
        for now in [160, 180]:
            with tempfile.TemporaryDirectory() as tmp:
                ns, calls = scenario(pathlib.Path(tmp), now)
                with patch(
                    "subprocess.run",
                    return_value=SimpleNamespace(returncode=1, stdout=""),
                ):
                    exec(final(new), ns)
                saved = json.loads((pathlib.Path(tmp) / "result.json").read_text())
                self.assertEqual(saved["status"], "passed" if now == 160 else "failed")
                if now == 160:
                    self.assertEqual(calls[0], "restore")
                    self.assertTrue(ns["observations"]["osRestoreAttempt"]["verified"])
                else:
                    self.assertNotIn("restore", calls)
                    self.assertIn("eof", calls)
                    self.assertFalse(ns["observations"]["osRestoreAttempt"]["verified"])

    def test_original_scheduler_and_manifest_formatter_contract_not_native_sender(self):
        code = """import assert from'node:assert/strict';import{createMemoryExtractionScheduler,buildMemoryExtractionPrompt}from'./clients/uwork/apps/zcode-cli/packages/core/src/memory/extraction.ts';import{scanMemoryManifest,formatMemoryManifest}from'./clients/uwork/apps/zcode-cli/packages/core/src/memory/recall/manifest.ts';import{MANIFEST_PROMPT,MANIFEST_MARKER,TOPIC_TEXT}from'./scripts/fixtures/mac-memory-manifest-filesystem-denied.mjs';let eligible=0;const scheduler=createMemoryExtractionScheduler(async()=>{eligible++;return'success'});try{scheduler.schedule({boundaryMessageId:'assistant',durableMessages:[{info:{id:'user',sessionID:'sess_owned',role:'user',time:{created:1}},parts:[{id:'typed',type:'text',text:MANIFEST_PROMPT},{id:'context',type:'text',text:'Synthetic contextual words are not an explicit user request',synthetic:true}]},{info:{id:'assistant',sessionID:'sess_owned',role:'assistant',time:{created:2,completed:3}},parts:[{id:'reply',type:'text',text:'Original no tool reply.'}]}],memoryRoot:'/owned/memory',workingDirectory:'/owned',workspaceRoot:'/owned'});await scheduler.drain();assert.equal(eligible,1);assert.equal(scheduler.getCursor(),'assistant');assert.equal(scheduler.hasPendingWork(),false)}finally{scheduler.shutdown()}let lines;const entries=await scanMemoryManifest({fileSystem:{listDirectory:async()=>({entries:[{kind:'file',path:'/owned/memory/owned-manifest-topic.md'}]}),stat:async()=>({kind:'file',mtimeMs:123}),readTextFileRange:async(input)=>{lines=input.limitLines;return{content:TOPIC_TEXT}}},rootDir:'/owned/memory'});assert.equal(lines,30);assert.equal(entries.length,1);assert.equal(entries[0].description,MANIFEST_MARKER);assert(formatMemoryManifest(entries).includes(MANIFEST_MARKER));assert(buildMemoryExtractionPrompt({manifest:entries,messageCount:2}).includes(MANIFEST_MARKER));"""
        p = subprocess.run(
            [NODE, "--import", "tsx", "--input-type=module", "-e", code],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(p.returncode, 0, p.stderr)

    def test_actual_status_producer_uses_original_capture_and_canonical_phase(self):
        code = """import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{parse}from'acorn';import{deriveManifestFixture}from'./scripts/fixtures/mac-memory-manifest-filesystem-denied.mjs';import{captureMacBackendStage,MAC_STAGE_SELECTS}from'./scripts/fixtures/mac-backend-stage-snapshot.mjs';const s=deriveManifestFixture(readFileSync('scripts/fixtures/client-native-enterprise.mjs','utf8'));let b;const walk=n=>{if(!n||typeof n!=='object')return;if(n.type==='IfStatement'&&s.slice(n.test.start,n.test.end).includes("c.op==='manifestMemoryStatus'"))b=n.consequent;for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v)}};walk(parse(s,{ecmaVersion:'latest',sourceType:'module'}));assert(b);const db={all:(sql,...args)=>sql===MAC_STAGE_SELECTS.member?[{tenant_id:args[0],user_id:args[1],role:'member',status:'active',seat:1,department_id:null}]:[]},stop=Symbol('actual snapshot accepted'),phases=[];const base={authority:'owned-fixture-existing-db',phase:'warm',sampledAt:Date.now(),actors:[{label:'current',tenantId:'t',userId:'a'},{label:'other',tenantId:'t',userId:'b'}]};const bind={c:null,memoryPrevious:{stage:'warm',snapshot:captureMacBackendStage(db,base)},manifestObserverFailed:false,manifestExposure:null,api:async(path,method,data)=>path.includes('/configurations/')?{published:{allowFilesystem:false},version:1,revision:2}:{allowed:data.action==='execution',security:{allowFilesystem:false},tenantId:'t'},p:'/api/tenants/t',identity:'synthetic-only',owner:{tenantId:'t'},member:{id:'a'},app:{services:{db}},captureMacBackendStage:(d,c)=>{phases.push(captureMacBackendStage(d,c).phase);throw stop}};const run=new(Object.getPrototypeOf(async function(){}).constructor)(...Object.keys(bind),s.slice(b.start+1,b.end-1));for(const op of['manifestMemoryStatus','manifestMemoryComplete']){bind.c={op};await assert.rejects(()=>run(...Object.values(bind)),e=>e===stop)}assert.deepEqual(phases,['manifest-memory-status','manifest-memory-complete']);"""
        p = subprocess.run(
            [NODE, "--input-type=module", "-e", code],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(p.returncode, 0, p.stderr)


if __name__ == "__main__":
    unittest.main()
