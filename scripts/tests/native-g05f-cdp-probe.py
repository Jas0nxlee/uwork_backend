#!/usr/bin/env python3
"""G05f probe: saved-workflow global group, "运行于" project selection, run cwd and revocation.

Drives the real Electron app in the dynamic-workflow (alwaysOn) fixture: creates a saved
workflow through the model SaveWorkflow tool call plus the original approval UI, promotes it
to the global group, then launches it with an explicit "运行于" project through the original
launch dialog. Reuses the G04k probe's owned fixture/bridge/guards. Not the reviewed Go/actor
ceremony.
"""
import argparse, importlib.util, json, os, re, shutil, subprocess, sys, time
from pathlib import Path

REPO = Path('/Users/ljp/Desktop/uwork_backend')
ROOT_REPO = REPO
HARNESS = REPO / 'scripts/tests/native-g04k-cdp-probe.py'

spec = importlib.util.spec_from_file_location('native_g04k_probe', HARNESS)
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)
need = harness.need
ProbeError = harness.ProbeError
LAST = harness.LAST_OBSERVATIONS

WORKFLOW_DOM = r'''(()=>{
  let invalid=false;const overflow=[];
  const list=(s,b=document,n=32)=>{const a=Array.from(b?.querySelectorAll(s)??[]);if(a.length>n){invalid=true;overflow.push(s+':'+a.length);return [];}return a;};
  const maybe=(s,b=document)=>{const a=list(s,b);return a.length===1?a[0]:null;};
  const one1=id=>maybe('[data-testid="'+id+'"]');
  const visible=e=>!!e&&!e.hidden&&!e.closest('[hidden],[aria-hidden="true"],[inert]')&&e.getClientRects().length>0;
  const text=(e,n=512)=>{if(!e)return null;const t=(e.textContent??'').replace(/\s+/g,' ').trim();if(t.length>n){invalid=true;return null;}return t||null;};
  const point=e=>{if(!visible(e))return null;const r=e.getBoundingClientRect(),l=Math.max(0,r.left),t=Math.max(0,r.top),z=Math.min(innerWidth,r.right),b=Math.min(innerHeight,r.bottom);if(z<=l||b<=t)return null;const x=(l+z)/2,y=(t+b)/2,h=document.elementFromPoint(x,y);return{x,y,visible:true,hit:!!h&&(h===e||e.contains(h)),disabled:e.disabled===true||e.getAttribute('aria-disabled')==='true'||e.hasAttribute('data-disabled')};};
  const cards=list('[data-testid^="workflow-card-"]',document,16).filter(e=>visible(e)&&e.getAttribute('data-testid')!=='workflow-card-run');
  const runButtons=list('[data-testid^="workflow-card-run-"]',document,8).filter(visible);
  const dialog=maybe('[data-testid="workflow-launch-dialog"]');
  const permission=maybe('[role="dialog"]');
  const permissionButtons=permission?list('button',permission,16).filter(visible):[];
  const rows=list('[data-testid^="workflow-run-row-"]',document,16).filter(visible);
  const workflowTab=maybe('[data-testid="automations-page-tab-workflow"]');
  const composer=one1('v4-composer-input'),send=one1('v4-composer-send');
  const NAME='native-ui-workflow';
  return{version:1,invalid,overflow,
    composerPresent:!!composer,composerPoint:point(composer),composerText:composer?(composer.value??composer.innerText??'').slice(0,64):null,
    sendPoint:point(send),sendDisabled:send?send.disabled===true:null,
    workflowTabPoint:point(workflowTab),
    createViaChat:point(one1('workflows-create-via-chat-global')),
    createViaChatAny:point(one1('workflows-create-via-chat-global') ?? maybe('[data-testid^="workflows-create-via-chat"]')),
    moveDialog:point(one1('workflow-move-dialog')),moveTarget:point(one1('workflow-move-dialog-target')),
    moveSubmit:point(one1('workflow-move-dialog-submit')),
    named:(()=>{const group=one1('workflow-global-group');
      const named=list('[data-testid="workflow-card-'+NAME+'"]',document,4);
      const inside=e=>!!group&&group.contains(e);
      const pack=e=>e?{card:point(e),
        run:point((list('[data-testid^="workflow-card-run-"]',e,4).filter(visible)[0])??null),
        menu:point((list('[data-testid^="workflow-card-menu-"]',e,4).filter(visible)[0])??null),
        present:true}:{card:null,run:null,menu:null,present:false};
      const g=named.find(inside)??null,project=named.find(e=>!inside(e))??null;
      return {global:pack(g),project:pack(project),
        move:point(one1('workflow-action-move-'+NAME)),
        cardPresent:!!project,globalPresent:!!g};})(),
    moveOptions:list('[role="option"]',document,8).map(e=>({label:text(e,48),point:point(e)})),
    topNavBack:point(one1('desktop-top-nav-back')),
    breadcrumbItems:(()=>{const box=one1('settings-breadcrumb-section');if(!box)return null;
      return list('button,[role="button"],a',box,6).map(e=>({label:text(e,48),point:point(e)}));})(),
    detailOpen:!!one1('workflow-detail'),
    detailTabs:(()=>{const box=one1('workflow-detail-tab');if(!box)return null;
      return list('button,[role="tab"]',box,4).map(e=>({label:text(e,48),point:point(e)}));})(),
    historyTab:(()=>{const box=one1('workflow-detail-tab');if(!box)return null;
      const tabs=list('button,[role="tab"]',box,4);
      const target=tabs.find(e=>(text(e,48)??'').includes('运行历史'))??null;return point(target);})(),
    agentsMenu:point(one1('enterprise-menu-agents')),
    automationsOpen:point(one1('automations-open')),
    globalGroup:point(one1('workflow-global-group')),projectGroup:point(one1('workflow-project-group')),
    empty:visible(one1('workflows-empty')),
    cardCount:cards.length,
    cards:cards.map(e=>({id:e.getAttribute('data-testid'),text:text(e,200),point:point(e),
      run:point((list('[data-testid^="workflow-card-run-"]',e,4).filter(visible)[0])??null),
      menu:point((list('[data-testid^="workflow-card-menu-"]',e,4).filter(visible)[0])??null)})),
    runButtons:runButtons.map(e=>({id:e.getAttribute('data-testid'),point:point(e)})),
    launch:{open:!!dialog,target:point(one1('workflow-launch-target')),submit:point(one1('workflow-launch-submit')),
      error:text(one1('workflow-launch-error'),256),text:text(dialog,400)},
    permission:(()=>{const box=list('[role="listbox"]',document,2).filter(visible)[0]??null;
      const options=box?list('[role="option"]',box,8):[];
      const confirm=list('button',document,64).filter(e=>visible(e)&&e.getAttribute('aria-label')==='确认')[0]??null;
      return {open:!!box,optionCount:options.length,
        options:options.map(e=>({label:text(e,48),point:point(e)})),
        confirm:point(confirm),
        surface:text(box?box.parentElement?.parentElement??null:null,300)};})(),
    runRows:rows.map(e=>({text:text(e,200),
      path:e.querySelector('[title]')?.getAttribute('title')??null})),
    timeline:text(one1('v4-timeline'),900),dialogs:list('[role="dialog"]',document,4).map(e=>text(e,200)),
    composerValue:(composer?(composer.value??''):'').slice(0,64)};
})()'''

CENSUS = r"""(()=>{const seen=[];for(const e of document.querySelectorAll('[data-testid]')){if(e.getClientRects().length>0)seen.push(e.getAttribute('data-testid'));}
return {version:1,count:seen.length,ids:seen.slice(0,400)};})()"""


def project(bridge, label=None):
    value = bridge.evaluate(WORKFLOW_DOM)
    if label:
        LAST[label] = value
    need(value.get('invalid') is False,
         'workflow projection was ambiguous: ' + ','.join(value.get('overflow') or []))
    return value


def click(bridge, guards, step, point):
    need(point is not None and point['visible'] and point['hit'] and not point['disabled'],
         'control not clickable: ' + step)
    need(guards.claim(step), 'action already used: ' + step)
    harness.click_point(bridge, point)


def wait_for(read, predicate, seconds, label):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = read()
        if predicate(last):
            return last
        time.sleep(0.4)
    LAST[label] = last
    raise ProbeError('no match: ' + label + ' last=' + json.dumps(last, ensure_ascii=False)[:700])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile', default='client-native-g05f-probe-20261019')
    parser.add_argument('--stop-after', default='discover-save')
    arguments = parser.parse_args()
    profile = arguments.profile
    need(re.fullmatch(r'client-native-[a-z0-9-]+', profile), 'bad profile name')

    root, evidence = REPO / 'data' / profile, REPO / 'evidence' / profile
    for path in (root, evidence):
        shutil.rmtree(path, ignore_errors=True)
    (evidence / 'controller-home').mkdir(parents=True, mode=0o700)
    (evidence / 'controller-tmp').mkdir(parents=True, mode=0o700)

    first = harness.runpy.run_path(str(REPO / 'scripts/fixtures/native-first-run-ui.py'))
    fixtures = bridge = guards = None
    checks, observations = [], {}
    error = None
    try:
        fixtures = harness.Fixture(profile, evidence / 'controller-home',
                                   evidence / 'controller-tmp', mode='workflow')
        fixtures.wait_event(lambda e: e.get('event') == 'ready', 240, 'ready')
        fixtures.send({'op': 'launch'})
        launched = fixtures.wait_event(lambda e: e.get('event') == 'launched', 120, 'launched')
        renderer = (root / 'runtime/app/out/renderer/index.html').as_uri()
        bridge = harness.Bridge(launched['cdpPort'], renderer)
        guards = harness.Guards(evidence)
        checks.append('owned-main-renderer-attached-over-loopback-cdp')

        first_run = first['FirstRunUi'](
            'file-restored', lambda expression: bridge.evaluate(expression),
            bridge.raw_cdp, guards.guard, guards.budget, guards.claim, guards.auth_started)

        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            value = first_run.phase('observe')
            LAST['initial-observe'] = value
            if not value['startupLoadingVisible'] and (
                    value['onboardingVisible'] or value['ready'] or value['loginVisible']):
                break
            time.sleep(0.5)
        workspace = root / 'project-g05f'
        workspace.mkdir(parents=True, mode=0o700)
        subprocess.run(['/usr/bin/git', 'init', '--quiet', str(workspace)], check=True)
        fixtures.command('openWorkspace', 60, workspacePath=str(workspace))
        checks.append('owned-git-workspace-opened-through-the-original-command')
        ready = advance(first_run)
        need(ready['ready'], 'the workspace never became ready')
        checks.append('original-first-run-onboarding-actions-and-restored-identity')

        # The enterprise filesystem policy defaults to denied; publishing the current policy
        # through the fixture's own configuration command is what a real admin would do.
        fixtures.command('configure', 60, kind='security', data={'allowFilesystem': True})
        checks.append('published-current-security-policy-allowing-filesystem')

        LAST['workspace-census'] = bridge.evaluate(CENSUS)
        view = wait_for(lambda: project(bridge, 'workspace'),
                        lambda v: v['composerPresent'] and v['sendPoint'], 40, 'composer ready')

        # Existing entry: the saved-workflow hub, reached through the routed agents menu.
        entry = wait_for(lambda: project(bridge, 'entry'),
                         lambda v: v['agentsMenu'] or v['automationsOpen'], 30, 'automation entry')
        click(bridge, guards, 'open_automations',
              entry['automationsOpen'] or entry['agentsMenu'])
        hub = wait_for(lambda: project(bridge, 'hub'),
                       lambda v: v['workflowTabPoint'] or v['createViaChatAny'], 30, 'automations page')
        if hub['workflowTabPoint']:
            click(bridge, guards, 'workflow_tab', hub['workflowTabPoint'])
            hub = wait_for(lambda: project(bridge, 'workflowHub'),
                           lambda v: v['createViaChatAny'] or v['empty'] or v['cardCount'], 30, 'workflow hub')
        checks.append('original-workflow-hub-opened-from-the-routed-menu')
        observations['hub'] = {'empty': hub['empty'], 'cards': hub['cardCount'],
                               'createViaChat': bool(hub['createViaChatAny'])}
        if arguments.stop_after == 'hub':
            return finish(profile, evidence, checks, observations, fixtures, bridge, guards, 'partial')

        # Existing entry for authoring: the hub's create-via-chat starts the workflow conversation.
        create = wait_for(lambda: project(bridge, 'create'),
                          lambda v: v['createViaChatAny'], 20, 'create-via-chat control')
        click(bridge, guards, 'create_via_chat', create['createViaChatAny'])
        view = wait_for(lambda: project(bridge, 'authoring'),
                        lambda v: v['composerPresent'] and v['sendPoint'], 40, 'workflow composer')

        # Ask the controlled model for a SaveWorkflow call through the original composer.
        harness.click_point(bridge, view['composerPoint'])
        bridge.raw_cdp('Input.insertText', text='NATIVE_UI_WORKFLOW_SAVE')
        typed = wait_for(lambda: project(bridge, 'typed'), lambda v: (v['composerText'] or '').strip(), 20, 'typed composer text')
        click(bridge, guards, 'composer_send', typed['sendPoint'])
        checks.append('original-composer-sent-the-save-workflow-request')

        time.sleep(15)
        tools = model_request_tools(fixtures, evidence, 'save-request')
        observations['saveRequest'] = {'count': tools['count'], 'stream': tools['stream'],
                                       'hasSaveWorkflow': [('SaveWorkflow' in names) for names in tools['toolSets']],
                                       'firstToolCount': len(tools['toolSets'][0]) if tools['toolSets'] else 0}
        permission = wait_for(lambda: project(bridge, 'permission'),
                              lambda v: v['permission']['open'], 20, 'SaveWorkflow permission dialog')
        LAST['permission-census'] = bridge.evaluate(CENSUS)
        observations['permission'] = permission['permission']
        observations['permission'] = permission['permission']
        if arguments.stop_after == 'discover-save':
            return finish(profile, evidence, checks, observations, fixtures, bridge, guards, 'partial')

        # Approve through the original dialog: select the allow option, then confirm.
        allow = next((option for option in permission['permission']['options']
                      if '允许' in (option['label'] or '')), None)
        need(allow is not None, 'the permission dialog offered no allow option')
        click(bridge, guards, 'permission_allow', allow['point'])
        confirmed = wait_for(lambda: project(bridge, 'allowed'),
                             lambda v: v['permission']['confirm'], 20, 'permission confirm')
        click(bridge, guards, 'permission_confirm', confirmed['permission']['confirm'])
        checks.append('original-save-workflow-permission-allow-selected-and-confirmed')

        definition = workspace / '.zcode/workflows/native-ui-workflow.dwf.ts'
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline and not definition.exists():
            time.sleep(0.5)
        need(definition.exists(), 'the approved workflow definition was not written to the workspace')
        observations['definition'] = {'path': str(definition.relative_to(ROOT_REPO)), 'bytes': definition.stat().st_size}
        checks.append('approved-save-wrote-the-project-workflow-definition')

        # Back to the hub through the routed menu, then promote the project workflow to global.
        goto_hub(bridge, guards, lambda: project(bridge))
        card = wait_for(lambda: project(bridge, 'projectCard'),
                        lambda v: v['named']['project']['present'], 30, 'project workflow card')
        checks.append('saved-workflow-appears-in-the-project-group')
        read = lambda: project(bridge)
        # Promoting a project workflow to global is an agent turn: the original card action
        # prefills the composer, and the model must re-save the workflow with global scope.
        click_fresh(bridge, guards, 'open_card_menu', read, lambda v: v['named']['project']['menu'])
        click_fresh(bridge, guards, 'promote_via_chat', read, lambda v: v['named']['move'])
        harness.click_point(bridge, wait_for(read, lambda v: v['sendPoint'], 30, 'promotion composer')['composerPoint'])
        bridge.raw_cdp('Input.insertText', text=' NATIVE_UI_WORKFLOW_SAVE NATIVE_UI_WORKFLOW_GLOBAL')
        typed = wait_for(read, lambda v: 'NATIVE_UI_WORKFLOW_GLOBAL' in (v['composerText'] or ''), 20,
                         'promotion request text')
        click_fresh(bridge, guards, 'promotion_send', read, lambda v: v['sendPoint'])
        promotion = wait_for(read, lambda v: v['permission']['open'], 60, 'global save permission')
        allow = next((option for option in promotion['permission']['options']
                      if '允许' in (option['label'] or '')), None)
        need(allow is not None, 'the global save dialog offered no allow option')
        click(bridge, guards, 'global_allow', allow['point'])
        click_fresh(bridge, guards, 'global_confirm', read, lambda v: v['permission']['confirm'])
        global_definition = root / 'data/.uwork/workflows/native-ui-workflow.dwf.ts'
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline and not global_definition.exists():
            time.sleep(0.5)
        need(global_definition.exists(),
             'the approved promotion did not write the global workflow definition')
        observations['globalDefinition'] = {'path': str(global_definition.relative_to(ROOT_REPO)),
                                            'bytes': global_definition.stat().st_size}
        checks.append('agent-promotion-wrote-the-global-workflow-definition')

        goto_hub(bridge, guards, read, 'after_promotion')
        card = wait_for(lambda: project(bridge, 'globalGroup'),
                        lambda v: v['named']['globalPresent'] and v['globalGroup'], 40,
                        'workflow in the global group')
        checks.append('global-group-owns-the-promoted-workflow')
        if arguments.stop_after == 'moved':
            return finish(profile, evidence, checks, observations, fixtures, bridge, guards, 'partial')

        # Launch from the global group and pick the opened project as the "运行于" target.
        click_fresh(bridge, guards, 'global_run', read, lambda v: v['named']['global']['run'])
        launch = wait_for(read, lambda v: v['launch']['open'] and v['launch']['target'], 30, 'launch dialog')
        LAST['launch-dialog'] = launch['launch']
        if arguments.stop_after == 'launch':
            return finish(profile, evidence, checks, observations, fixtures, bridge, guards, 'partial')
        click_fresh(bridge, guards, 'launch_target', read, lambda v: v['launch']['target'])
        targets = wait_for(read, lambda v: len(v['moveOptions']) >= 1, 20, 'launch target options')
        LAST['launch-targets'] = targets['moveOptions']
        need(targets['moveOptions'], 'the launch dialog offered no project target')
        project_option = next((o for o in targets['moveOptions']
                               if 'project-g05f' in (o['label'] or '')), None)
        need(project_option is not None, 'the launch dialog did not offer the opened project')
        click_fresh(bridge, guards, 'launch_target_project', read,
                    lambda v: next((o['point'] for o in v['moveOptions']
                                    if 'project-g05f' in (o['label'] or '')), None))
        checks.append('original-launch-dialog-selected-the-opened-project-as-its-run-target')
        click_fresh(bridge, guards, 'launch_submit', read, lambda v: v['launch']['submit'])
        launched = wait_for(read, lambda v: not v['launch']['open'], 30, 'launch dialog closed')
        LAST['after-launch'] = {'timeline': launched.get('timeline'), 'composer': launched.get('composerPresent')}
        if arguments.stop_after == 'launched':
            return finish(profile, evidence, checks, observations, fixtures, bridge, guards, 'partial')

        # Wait for the run's actor turns to reach the controlled supplier, then read the cwd.
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            tools = model_request_tools(fixtures, evidence, 'after-run')
            if tools['count'] >= 6:
                break
            time.sleep(3)
        cwd = run_cwd_evidence(evidence, workspace)
        observations['runCwd'] = cwd
        need(cwd['modelRequestCwd'] is not None,
             'no run model request carried the selected project as its working directory')
        checks.append('run-model-requests-carried-the-selected-project-directory')

        # The original run history must record the same cwd the model actually used.
        goto_hub(bridge, guards, read, 'after_run')
        click_fresh(bridge, guards, 'open_workflow_detail', read, lambda v: v['named']['global']['card'])
        click_fresh(bridge, guards, 'open_run_history', read, lambda v: v['historyTab'])
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            if project(bridge, 'detailSettled')['runRows']:
                break
            time.sleep(1)
        LAST['detail-census'] = bridge.evaluate(
            "(()=>{const a=[];for(const e of document.querySelectorAll('[data-testid]'))"
            "{if(e.getClientRects().length>0)a.push(e.getAttribute('data-testid'));}return {version:1,ids:a.slice(0,80)};})()")
        LAST['detail-tabs'] = project(bridge, 'detailTabsState')['detailTabs']
        detail = wait_for(read, lambda v: v['runRows'], 60, 'workflow run history')
        rows = detail['runRows']
        observations['runRows'] = rows[:4]
        need(any((row.get('path') or '') == str(workspace) for row in rows),
             'the original run history did not record the selected project as run.cwd')
        checks.append('original-run-history-cwd-matches-the-model-working-directory')
        if arguments.stop_after == 'detail':
            return finish(profile, evidence, checks, observations, fixtures, bridge, guards, 'partial')

        # Revoke the filesystem permission, then launch the same global workflow again.
        fixtures.command('configure', 60, kind='security', data={'allowFilesystem': False})
        checks.append('revoked-the-current-filesystem-policy')
        goto_hub(bridge, guards, read, 'after_revoke')
        click_fresh(bridge, guards, 'revoked_run', read, lambda v: v['named']['global']['run'])
        revoked = wait_for(read, lambda v: v['launch']['open'] and v['launch']['target'], 30,
                           'revoked launch dialog')
        click_fresh(bridge, guards, 'revoked_target', read, lambda v: v['launch']['target'])
        wait_for(read, lambda v: len(v['moveOptions']) >= 1, 20, 'revoked launch targets')
        click_fresh(bridge, guards, 'revoked_target_project', read,
                    lambda v: next((o['point'] for o in v['moveOptions']
                                    if 'project-g05f' in (o['label'] or '')), None))
        click_fresh(bridge, guards, 'revoked_submit', read, lambda v: v['launch']['submit'])

        refused = None
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            state = read()
            error = state['launch']['error']
            timeline = state.get('timeline') or ''
            if error or 'enterprise_filesystem_denied' in timeline or '拒绝' in timeline:
                refused = {'launchError': error, 'timeline': timeline[:400]}
                break
            time.sleep(2)
        LAST['revoked'] = refused if refused else read()
        need(refused is not None,
             'the revoked filesystem policy did not refuse the second workflow run')
        observations['revoked'] = refused
        checks.append('revoked-filesystem-policy-refused-the-second-run')

        return finish(profile, evidence, checks, observations, fixtures, bridge, guards, 'passed')
    except Exception as caught:  # first failure stops business and keeps the roots
        error = caught
        return finish(profile, evidence, checks, observations, fixtures, bridge, guards, 'failed', caught)


def model_request_tools(fixtures, evidence, name):
    """Read the controlled request bodies the fixture already records for this run."""
    fixtures.command('experienceSnapshot', 60, name=name)
    proof = json.loads((evidence / f'{name}-experience-proof.json').read_text())
    requests = proof.get('modelRequests') or []
    return {
        'count': len(requests),
        'toolSets': [
            sorted(tool['function']['name'] for tool in (body.get('tools') or []))
            for body in requests
        ],
        'stream': [bool(body.get('stream')) for body in requests],
    }


def click_fresh(bridge, guards, step, read, pick, tries=6, seconds=0.4):
    """Re-read the projection right before clicking: popup menus close between reads."""
    last = None
    for _ in range(tries):
        last = read()
        point = pick(last)
        if point is not None and point['visible'] and point['hit'] and not point['disabled']:
            click(bridge, guards, step, point)
            return last
        time.sleep(seconds)
    LAST[step + '-unclickable'] = last
    raise ProbeError('control never became clickable: ' + step)


def run_cwd_evidence(evidence, workspace):
    """Read the cwd the run's own model requests used, from the requests the fixture records."""
    proof = json.loads((evidence / 'after-run-experience-proof.json').read_text())
    found = []
    for body in proof.get('modelRequests') or []:
        text = json.dumps(body, ensure_ascii=False)
        if 'NATIVE_UI_WORKFLOW_ACTOR' not in text:
            continue
        for message in body.get('messages') or []:
            content = message.get('content')
            blob = content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)
            for line in blob.splitlines():
                stripped = line.strip()
                if 'working directory' in stripped.lower() or stripped.lower().startswith('cwd'):
                    found.append(stripped[:200])
    return {'actorRequestCount': len(found), 'lines': sorted(set(found))[:8],
            'expectedProject': str(workspace),
            'modelRequestCwd': str(workspace) if any(str(workspace) in line for line in found) else None}


def goto_hub(bridge, guards, project_read, tag='first'):
    """Reach the saved-workflow hub through the routed menu and its workflow tab."""
    for attempt in range(3):
        leaving = project_read()
        if leaving.get('detailOpen'):
            # The detail view is a full page; leave it through its own back control first.
            back = leaving.get('topNavBack') or next(
                (item['point'] for item in (leaving.get('breadcrumbItems') or [])
                 if item['point'] and item['point']['visible']), None)
            if back:
                click(bridge, guards, f'hub_back_{tag}_{attempt}', back)
                time.sleep(1.5)
        entry = wait_for(project_read, lambda v: v['agentsMenu'] or v['automationsOpen'], 25, 'routed menu entry')
        if entry['createViaChatAny'] and entry['globalGroup']:
            return entry
        click(bridge, guards, f'hub_reopen_{tag}_{attempt}', entry['automationsOpen'] or entry['agentsMenu'])
        hub = wait_for(project_read, lambda v: v['workflowTabPoint'], 25, 'automations page')
        if not (hub['createViaChatAny'] and hub['globalGroup']):
            click(bridge, guards, f'hub_tab_{tag}_{attempt}', hub['workflowTabPoint'])
        ready = wait_for(project_read, lambda v: v['createViaChatAny'] and v['globalGroup'], 25, 'workflow hub')
        LAST['hub-census'] = bridge.evaluate(
            "(()=>{const a=[];for(const e of document.querySelectorAll('[data-testid^=\"workflow\"]'))"
            "{if(e.getClientRects().length>0)a.push(e.getAttribute('data-testid'));}return {version:1,ids:a.slice(0,60)};})()")
        return ready
    raise ProbeError('the workflow hub never came back')


def advance(first_run):
    for _ in range(20):
        value = first_run.phase('observe')
        LAST['onboarding'] = value
        if value['ready']:
            return value
        step = value['step']
        if step == 'role':
            first_run.phase('select_developer' if not value['developerSelected'] else 'next_role')
        elif step == 'mode':
            first_run.phase('select_coding' if not value['codingSelected'] else 'next_mode')
        elif step == 'preferences':
            first_run.phase('finish')
        else:
            time.sleep(0.5)
    LAST['onboarding-final'] = first_run.phase('observe')
    raise ProbeError('onboarding never completed')


def finish(profile, evidence, checks, observations, fixtures, bridge, guards, status, error=None):
    payload = dict(schema='g05f-native-cdp-probe-v1', status=status, profile=profile,
                   boundary='real native dynamic-workflow fixture (isolated backend, real Electron/Host, original '
                            'saved-workflow hub and launch dialog); CDP Input at real hit-tested points; not the '
                            'reviewed Go/actor ceremony',
                   checks=checks, observations=observations,
                   actions=guards.journal() if guards else [], lastObservations=LAST)
    if error is not None:
        payload['failure'] = type(error).__name__ + ': ' + str(error)[:300]
        payload['failureCode'] = getattr(error, 'code', None)
    try:
        if fixtures:
            fixtures.send({'op': 'stopNative'})
    except Exception:
        pass
    time.sleep(2)
    for child in (bridge, fixtures.child if fixtures else None):
        if child:
            try:
                child.kill()
            except Exception:
                pass
    evidence.mkdir(parents=True, exist_ok=True)
    (evidence / 'probe-result.json').write_text(json.dumps(payload, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    os.chmod(evidence / 'probe-result.json', 0o600)
    print(json.dumps({k: payload[k] for k in payload if k not in ('observations', 'lastObservations')},
                     ensure_ascii=False, indent=1))
    print('OBSERVATIONS', json.dumps(payload.get('observations', {}), ensure_ascii=False))
    return 0 if status == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
