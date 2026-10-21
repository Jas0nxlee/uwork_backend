"""Original warm5 plus same-session edit, assistant fork, child query and reload; prepare only by default."""

import argparse, ast, builtins, dis, hashlib, json, os, runpy, select, subprocess, time, types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROFILE = "client-native-packaged-macos-clock-arm64-message-edit-fork-v3-20261021"
M = runpy.run_path(str(ROOT / "scripts/tests/mac-arm64-memory-probe.py"))
BASE = M["BASE"]
EDIT = "UWORK_NATIVE_MESSAGE_EDIT_QUERY_20261021"
CHILD = "UWORK_NATIVE_MESSAGE_CHILD_QUERY_20261021"
EDIT_REPLY = "UWORK_MESSAGE_EDIT_REPLY_20261021"
CHILD_REPLY = "UWORK_MESSAGE_CHILD_REPLY_20261021"


def lifecycle_ui(marker, reply, expected=None, excluded=None):
    return (
        """(()=>{const panes=[...document.querySelectorAll('[data-session-id]')].filter(e=>e.getClientRects().length&&e.closest('[data-root-workspace-surface="interactive"]')&&!e.closest('[inert]')),p=panes.length===1?panes[0]:null,id=p?.getAttribute('data-session-id'),row=id?document.querySelector('[data-testid="task-item-'+id+'"]'):null,rows=p?[...p.querySelectorAll('[data-row-id]')]:[],users=rows.filter(e=>e.textContent.includes(%s)&&e.querySelector('[data-testid^="v4-edit-"]')),assistants=rows.filter(e=>e.textContent.includes(%s)),a=assistants.length===1?assistants[0]:null,aid=a?.getAttribute('data-row-id'),turn=a?.closest('section[data-turn-id][data-turn-key]'),forks=aid&&p?[...p.querySelectorAll('[data-testid="v4-fork-'+aid+'"]')]:[],sameTurn=!!turn&&forks.length===1&&forks[0].closest('section[data-turn-id][data-turn-key]')===turn,model=p?.querySelector('[data-testid="v4-model-config"][data-source="composer"]');return{ok:!!p&&!!row&&id?.startsWith('sess_')&&(!%s||id===%s)&&!%s.includes(id)&&users.length===1&&assistants.length===1&&forks.length===1&&sameTurn&&!p.querySelector('[data-testid="v4-stop"]'),sessionId:id??null,taskId:id??null,title:row?.querySelector('[data-task-title-copy="original"]')?.textContent.trim()??null,userRow:users[0]?.getAttribute('data-row-id')??null,assistantRow:aid??null,bodyMatchCount:assistants.length,exactForkMatchCount:forks.length,sameTurn,assistantTurnId:turn?.getAttribute('data-turn-id')??null,assistantTurnKey:turn?.getAttribute('data-turn-key')??null,model:model?.getAttribute('data-model')??null,reasoning:model?.getAttribute('data-thought')??null,identity:document.querySelector('[data-testid="enterprise-identity-name"]')?.innerText??null}})()"""
        % (
            json.dumps(marker),
            json.dumps(reply),
            json.dumps(expected),
            json.dumps(expected),
            json.dumps(excluded or []),
        )
    )


SLICE = (
    r"""
        parent_ui=until(lifecycle_ui('MACOS_CLOCK_LINK_20261020','UWORK_MESSAGE_WARM_REPLY_20261021'),'warm editable original rows',20)
        parent_id=parent_ui['taskId']
        message_db,bindings=mapped_database(observations['packagedCli'],root,workspace)
        def stage_proof(phase,dom):
            end=min(memory_work_end,time.monotonic()+15)
            expected={'warm':4,'edit':5,'fork':5,'child':6,'reload':6}[phase]
            previous=None
            while time.monotonic()<end:
                markers={'warm':('MACOS_CLOCK_LINK_20261020','UWORK_MESSAGE_WARM_REPLY_20261021'),'edit':(EDIT,EDIT_REPLY),'fork':(EDIT,EDIT_REPLY),'child':(CHILD,CHILD_REPLY),'reload':(CHILD,CHILD_REPLY)}
                fresh=bridge.evaluate(lifecycle_ui(*markers[phase],dom['taskId']))
                memory_budget_left(end)
                if not fresh.get('ok'):time.sleep(.15);continue
                assert fresh['identity']=='企业用户甲' and fresh['model']==meta['modelId'] and fresh['reasoning']=='none'
                dom.clear();dom.update(fresh)
                current=proof();memory_budget_left(end);assert current['modelCalls']<=expected
                request={'root':str(root),'workspacePath':str(workspace),'dbPath':message_db,'taskId':dom['taskId'],'phase':phase,'dom':dom}
                local=read_local(request,min(4,memory_budget_left(end)))
                memory_budget_left(end)
                if local and local['semanticSha256']==previous and current['own']['settled']==expected-2:
                    value=f.command('messageLifecycleProof',min(5,memory_budget_left(end)),phase=phase,taskId=dom['taskId'],dom=dom,dbPath=message_db)['facts']
                    memory_budget_left(end)
                    return value
                previous=local['semanticSha256'] if local else None
                time.sleep(.15)
            raise AssertionError('Message lifecycle proof unavailable')
        warm=stage_proof('warm',parent_ui)
        assert_backend_baseline(warm,delivered,meta['modelId'])
        observations['messageWarm']={'proof':warm,'ui':parent_ui,'actualDatabaseBindings':bindings}
        def hover_row(row_id):
            point=until("""
    + "'''"
    + r"""(()=>{const e=document.querySelector('[data-root-workspace-surface="interactive"] [data-row-id="'+%s+'"]');if(!e)return{ok:false};e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{ok:r.width>0&&r.height>0,x:r.x+r.width/2,y:r.y+r.height/2}})()"""
    + "'''"
    + r"""%json.dumps(row_id),'original row hover target',10)
            bridge.raw_cdp('Input.dispatchMouseEvent',type='mouseMoved',x=point['x'],y=point['y'])
        hover_row(parent_ui['userRow'])
        click('[data-testid="v4-edit-'+parent_ui['userRow']+'"]','original-user-edit')
        input_selector='[data-testid="v4-edit-input-'+parent_ui['userRow']+'"]'
        click(input_selector,'original-edit-input-focus')
        for kind in ['keyDown','keyUp']:bridge.raw_cdp('Input.dispatchKeyEvent',type=kind,key='a',code='KeyA',windowsVirtualKeyCode=65,nativeVirtualKeyCode=0,modifiers=4)
        bridge.raw_cdp('Input.insertText',text=EDIT)
        entered=until("""
    + "'''"
    + r"""(()=>{const e=document.querySelector(%s);return{ok:e?.innerText===%s,text:e?.innerText??null}})()"""
    + "'''"
    + r"""%(json.dumps(input_selector),json.dumps(EDIT)),'original edited text exact',10)
        click('[data-testid="v4-edit-submit-'+parent_ui['userRow']+'"]','original-edit-preserve-submit')
        edited=until(lifecycle_ui(EDIT,EDIT_REPLY,parent_id),'same-session edited turn completed',35)
        edit=stage_proof('edit',edited)
        updated=proof();assert updated['own']=={'count':3,'settled':3,'amount':66,'inputTokens':36,'outputTokens':30} and updated['other']==baseline['other'] and updated['modelCalls']==5
        observations['messageEdit']={'ui':edited,'input':entered,'proof':edit}
        hover_row(edited['assistantRow'])
        click('[data-testid="v4-fork-'+edited['assistantRow']+'"]','original-assistant-fork')
        forked=until(lifecycle_ui(EDIT,EDIT_REPLY,excluded=[parent_id]),'original fork task selected',20)
        assert forked['taskId']!=parent_id
        fork=stage_proof('fork',forked)
        assert proof()==updated
        observations['messageFork']={'ui':forked,'proof':fork}
        click('[data-root-workspace-surface="interactive"] [data-session-id="'+forked['taskId']+'"] [data-testid="v4-composer"] [contenteditable="true"]','original-child-composer')
        bridge.raw_cdp('Input.insertText',text=CHILD)
        click('[data-root-workspace-surface="interactive"] [data-session-id="'+forked['taskId']+'"] [data-testid="v4-composer-send"]','original-child-send')
        child=until(lifecycle_ui(CHILD,CHILD_REPLY,forked['taskId']),'original child continuation completed',35)
        child_proof=stage_proof('child',child)
        delivered=proof();assert delivered['own']=={'count':4,'settled':4,'amount':88,'inputTokens':48,'outputTokens':40} and delivered['other']==baseline['other'] and delivered['modelCalls']==6
        observations['messageChild']={'ui':child,'proof':child_proof}
        click('[data-testid="task-item-'+parent_id+'"]','original-parent-history-return')
        parent_again=until(lifecycle_ui(EDIT,EDIT_REPLY,parent_id),'parent branch unchanged after fork and child',15)
        parent_local=read_local({'root':str(root),'workspacePath':str(workspace),'dbPath':message_db,'taskId':parent_id,'phase':'edit','dom':parent_again},min(4,memory_budget_left(memory_work_end)))
        assert parent_local and parent_local['semanticSha256']==edit['local']['semanticSha256']
        observations['messageParentAfterChild']={'ui':parent_again,'local':parent_local}
        click('[data-testid="task-item-'+forked['taskId']+'"]','original-child-history-return')
        until(lifecycle_ui(CHILD,CHILD_REPLY,forked['taskId']),'child history reselected',15)
        bridge.raw_cdp('Page.reload')
        reloaded=until(lifecycle_ui(CHILD,CHILD_REPLY,forked['taskId']),'same child survives original reload',25)
        reload_proof=stage_proof('reload',reloaded)
        assert proof()==delivered
        observations['messageReload']={'ui':reloaded,'proof':reload_proof}
        checks.append('original-edit-same-session-one-call-fork-zero-child-one-reload-zero-and-accounting')
"""
)


def read_local(request, seconds):
    code = "import {readMessageLifecycle}from'./scripts/fixtures/mac-message-edit-fork-readonly.mjs';let s='';for await(const c of process.stdin)s+=c;try{console.log(JSON.stringify(readMessageLifecycle(JSON.parse(s))));}catch{process.exitCode=1;}"
    env = {
        "PATH": os.environ.get("PATH", ""),
        "TSX_TSCONFIG_PATH": str(
            ROOT / "clients/uwork/apps/zcode-cli/tsconfig.test.json"
        ),
    }
    result = subprocess.run(
        [
            M["COLD"]["NODE"],
            "--import",
            str(ROOT / "clients/uwork/node_modules/tsx/dist/loader.mjs"),
            "--input-type=module",
            "-e",
            code,
        ],
        cwd=ROOT,
        input=json.dumps(request),
        capture_output=True,
        text=True,
        timeout=seconds,
        env=env,
    )
    return json.loads(result.stdout) if result.returncode == 0 else None


def deriveMessageProbe(original):
    original_deriver = M["deriveMemoryProbe"]
    deriver = types.FunctionType(
        original_deriver.__code__,
        {**original_deriver.__globals__, "MEMORY_SLICE": SLICE},
    )
    source = deriver(original)
    assert source.count("['scripts/fixtures/mac-arm64-memory-derived.mjs']") == 1
    source = source.replace(
        "['scripts/fixtures/mac-arm64-memory-derived.mjs']",
        "['scripts/fixtures/mac-message-edit-fork-derived.mjs']",
    )
    anchor = "                command = command[:-1] + ['scripts/fixtures/mac-message-edit-fork-derived.mjs']"
    assert source.count(anchor) == 1
    source = source.replace(
        anchor,
        anchor
        + "\n                kwargs['env']['TSX_TSCONFIG_PATH']=str(REPO/'clients/uwork/apps/zcode-cli/tsconfig.test.json')",
    )
    return source


def createMessageNamespace(source, budget):
    M["wait_renderer"].__globals__["MEMORY_ACTIVE_BUDGET"] = budget
    ns = M["create_memory_namespace"](source, budget)
    ns.update(
        lifecycle_ui=lifecycle_ui,
        read_local=read_local,
        EDIT=EDIT,
        CHILD=CHILD,
        EDIT_REPLY=EDIT_REPLY,
        CHILD_REPLY=CHILD_REPLY,
    )
    return ns


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(args):
    plan = json.loads(args.preparation.read_text())
    assert plan["profile"] == PROFILE
    assert (
        args.preparation.resolve()
        == ROOT / "data/sandbox-verification" / PROFILE / "preparation.json"
    )
    for path, expected in plan["sources"].items():
        assert digest(ROOT / path) == expected, path
    assert digest(__file__) == plan["driverSha256"]
    assert digest(plan["manifestPath"]) == plan["manifestSha256"]
    runpy.run_path(str(ROOT / "scripts/tests/macos-clock-profile.test.py"))["check"](
        PROFILE
    )
    source = deriveMessageProbe(BASE.read_text())
    compile(source, str(BASE), "exec")
    assert hashlib.sha256(source.encode()).hexdigest() == plan["derivedProbeSha256"]
    if not args.run:
        print(json.dumps({"status": "prepared-not-run", "profile": PROFILE}))
        return True
    assert args.reviewed_plan_sha256 == digest(args.preparation)
    budget = M["MemoryCaseBudget"]()
    ns = createMessageNamespace(source, budget)
    original_run, original_select = subprocess.run, select.select
    subprocess.run = lambda *a, **kw: budget.subprocess(original_run, *a, **kw)
    select.select = lambda *a, **kw: budget.select(original_select, *a, **kw)
    try:
        return ns["run"](PROFILE, Path(plan["manifestPath"]))
    finally:
        subprocess.run, select.select = original_run, original_select


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--preparation", type=Path, required=True)
    p.add_argument("--run", action="store_true")
    p.add_argument("--reviewed-plan-sha256")
    raise SystemExit(0 if run(p.parse_args()) else 1)
