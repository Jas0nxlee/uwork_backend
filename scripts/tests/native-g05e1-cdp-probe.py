#!/usr/bin/env python3
"""G05e1 probe: original Native automation pause/resume and delete confirm/cancel.

Runs the real Electron app from the native fixture, drives the original automation
page with CDP mouse input at real hit-tested points, and records the bounded public
projection at each step. Reuses the G04k probe's owned fixture/bridge/guards without
modifying them. Not the reviewed Go/actor ceremony.
"""
import argparse, importlib.util, json, os, re, shutil, sqlite3, subprocess, sys, threading, time
from pathlib import Path

REPO = Path('/Users/ljp/Desktop/uwork_backend')
HARNESS = REPO / 'scripts/tests/native-g04k-cdp-probe.py'


def load_harness():
    spec = importlib.util.spec_from_file_location('native_g04k_probe', HARNESS)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


harness = load_harness()
need = harness.need
ProbeError = harness.ProbeError
LAST = harness.LAST_OBSERVATIONS

AUTOMATION_DOM = r'''(()=>{
  let invalid=false;const listOverflow=[];
  const list=(s,b=document,n=32)=>{const a=Array.from(b?.querySelectorAll(s)??[]);if(a.length>n){invalid=true;listOverflow.push(s+':'+a.length+'>'+n);return [];}return a;};
  const ambiguous=[];
  const one=(s,b=document)=>{const a=list(s,b);if(a.length>1){invalid=true;ambiguous.push(s+':'+a.length);}return a.length===1?a[0]:null;};
  const visible=e=>!!e&&!e.hidden&&!e.closest('[hidden],[aria-hidden="true"],[inert]')&&e.getClientRects().length>0;
  const text=(e,n=256)=>{if(!e)return null;const t=(e.textContent??'').replace(/\s+/g,' ').trim();if(t.length>n){invalid=true;return null;}return t||null;};
  const point=e=>{if(!visible(e))return null;const r=e.getBoundingClientRect(),l=Math.max(0,r.left),t=Math.max(0,r.top),z=Math.min(innerWidth,r.right),b=Math.min(innerHeight,r.bottom);if(z<=l||b<=t)return null;const x=(l+z)/2,y=(t+b)/2,h=document.elementFromPoint(x,y);return{x,y,visible:true,hit:!!h&&(h===e||e.contains(h)),disabled:e.disabled===true||e.getAttribute('aria-disabled')==='true'||e.hasAttribute('data-disabled')};};
  const get=id=>one('[data-testid="'+id+'"]');
  // Transient popup controls: several menus can render the same option id, so a
  // duplicate must not poison the structural ambiguity guard.
  const maybe=id=>{const a=list('[data-testid="'+id+'"]');return a.length===1?a[0]:null;};
  const cards=list('[data-testid="automation-card"]',document,8).filter(visible);
  // The original card only prints a lifecycle label for paused/completed/failed;
  // an active card shows its schedule with the next run time instead.
  const status=e=>{const t=text(e,2048)??'';
    if(t.includes('已暂停'))return 'paused';
    if(t.includes('已完成'))return 'completed';
    if(t.includes('已失败'))return 'failed';
    if(t.includes('下次运行'))return 'active';
    return null;};
  const menuContent=list('[data-slot="dropdown-menu-content"]',document,4).filter(visible);
  const menu=menuContent.length===1?menuContent[0]:null;
  const dialog=one('[role="dialog"]',document);
  const buttons=dialog?list('button',dialog,32).filter(visible):[];
  const confirmButton=get('confirm-dialog-confirm');
  const cancelButtons=buttons.filter(e=>e!==confirmButton);
  const titleInput=get('automation-form-title'),promptInput=get('automation-form-prompt');
  return{version:1,invalid,ambiguous,listOverflow,
    sidebarEntry:point(maybe('automations-open')),
    agentsMenu:point(maybe('enterprise-menu-agents')),
    chatMenu:point(maybe('enterprise-menu-chat')),
    createManually:point(maybe('automation-create-manually')),
    createMenu:point(maybe('automation-create-menu')),
    listVisible:visible(maybe('automations-list')),
    form:{present:!!(titleInput||promptInput),
      title:point(titleInput),titleValue:titleInput?String(titleInput.value??''):null,
      prompt:point(promptInput),promptValue:promptInput?String(promptInput.value??''):null,
      submit:point(get('automation-form-submit')),
      scheduleAdd:point(maybe('automation-schedule-add')),
      dailyOption:point(maybe('automation-frequency-option-daily')),
      customOption:point(maybe('automation-frequency-option-custom')),
      unitSelect:point(maybe('automation-custom-unit-select')),
      minuteOption:point(maybe('automation-custom-unit-option-minute')),
      customConfirm:point(maybe('automation-custom-confirm')),
      frequency:point(maybe('automation-frequency-select')),frequencyText:maybe('automation-frequency-select')?text(maybe('automation-frequency-select'),96):null},
    cards:cards.map(e=>({status:status(e),point:point(e),
      menu:point(one('[data-testid="automation-card-menu"]',e)),
      text:(e.innerText??'').replace(/\s+/g,' ').trim().slice(0,300)})),
    menu:{open:!!menu,count:menuContent.length,
      toggle:menu?point(one('[data-testid="automation-action-toggle"]',menu)):null,
      toggleLabel:menu?text(one('[data-testid="automation-action-toggle"]',menu),32):null,
      delete:menu?point(one('[data-testid="automation-action-delete"]',menu)):null,
      deleteLabel:menu?text(one('[data-testid="automation-action-delete"]',menu),32):null},
    dialog:{open:!!dialog,confirm:point(confirmButton),confirmLabel:confirmButton?text(confirmButton,32):null,
      cancel:cancelButtons.length===1?point(cancelButtons[0]):null,
      cancelLabel:cancelButtons.length===1?text(cancelButtons[0],32):null,buttonCount:buttons.length}};
})()'''


def project(bridge, label=None):
    value = bridge.evaluate(AUTOMATION_DOM)
    if label:
        LAST[label] = value
    need(value.get('invalid') is False,
         'automation projection was ambiguous: ' + ','.join((value.get('ambiguous') or []) + (value.get('listOverflow') or [])))
    if label:
        LAST[label] = value
    return value


def click(module, bridge, step, point, guards):
    need(point is not None and point['visible'] and point['hit'] and not point['disabled'],
         'control not clickable: ' + step)
    need(guards.claim(step), 'action already used: ' + step)
    module.click_point(bridge, point)


def wait_for(read, predicate, seconds, label):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = read()
        if predicate(last):
            return last
        time.sleep(0.4)
    LAST[label] = last
    raise ProbeError('no match: ' + label + ' last=' + json.dumps(last, ensure_ascii=False)[:900])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile', default='client-native-g05e1-probe-20261019')
    parser.add_argument('--stop-after', default='full')
    parser.add_argument('--schedule', default='custom-minute', choices=('custom-minute', 'daily'))
    arguments = parser.parse_args()
    profile = arguments.profile
    need(re.fullmatch(r'client-native-[a-z0-9-]+', profile), 'bad profile name')

    root, evidence = REPO / 'data' / profile, REPO / 'evidence' / profile
    for path in (root, evidence):
        shutil.rmtree(path, ignore_errors=True)
    (evidence / 'controller-home').mkdir(parents=True, mode=0o700)
    (evidence / 'controller-tmp').mkdir(parents=True, mode=0o700)

    first = harness.runpy.run_path(str(REPO / 'scripts/fixtures/native-first-run-ui.py'))
    fixtures, observations, checks = None, {}, []
    bridge = None
    try:
        fixtures = harness.Fixture(profile, evidence / 'controller-home',
                                   evidence / 'controller-tmp', mode='experience')
        fixtures.wait_event(lambda e: e.get('event') == 'ready', 180, 'ready')
        fixtures.send({'op': 'launch'})
        launched = fixtures.wait_event(lambda e: e.get('event') == 'launched', 120, 'launched')
        renderer = (root / 'runtime/app/out/renderer/index.html').as_uri()
        bridge = harness.Bridge(launched['cdpPort'], renderer)
        guards = harness.Guards(evidence)
        checks.append('owned-main-renderer-attached-over-loopback-cdp')

        first_run = first['FirstRunUi'](
            'file-restored', lambda expression: bridge.evaluate(expression),
            bridge.raw_cdp, guards.guard, guards.budget, guards.claim, guards.auth_started)

        # Experience mode restores the identity from the production store and starts on
        # the original first-run onboarding, so wait for the app to be interactive first.
        deadline = time.monotonic() + 150
        started = None
        while time.monotonic() < deadline:
            value = first_run.phase('observe')
            LAST['initial-observe'] = value
            if not value['startupLoadingVisible'] and (
                    value['onboardingVisible'] or value['ready'] or value['loginVisible']):
                started = value
                break
            time.sleep(0.5)
        need(started is not None, 'the original UI never left startup loading')
        checks.append('original-first-run-ui-interactive')

        workspace = root / 'project-g05e1'
        workspace.mkdir(parents=True, mode=0o700)
        subprocess.run(['/usr/bin/git', 'init', '--quiet', str(workspace)], check=True)
        fixtures.command('openWorkspace', 60, workspacePath=str(workspace))
        checks.append('owned-git-workspace-opened-through-the-original-command')

        ready = advance_onboarding(first_run)
        need(ready['ready'], 'workspace never became ready after the first-run steps')
        need(ready['nameVisible'] and not ready['entryVisible'],
             'the restored identity was not presented after onboarding')
        checks.append('original-first-run-onboarding-actions-and-restored-identity')

        if arguments.stop_after == 'firstrun':
            return finish(profile, evidence, checks, observations, fixtures, bridge, guards, 'partial')

        # Original sidebar entry to the automation page.
        LAST['testid-census'] = bridge.evaluate(TESTID_CENSUS)
        # Unmanaged sidebars expose the built-in entry; the enterprise console routes the
        # same owner through its allowed builtin agents menu instead (no invented menu).
        view = wait_for(lambda: project(bridge, 'sidebar'),
                        lambda v: v['sidebarEntry'] or v['agentsMenu'], 30, 'automation entry')
        entry, name = (view['sidebarEntry'], 'automations_open') if view['sidebarEntry'] \
            else (view['agentsMenu'], 'enterprise_agents_menu')
        click(harness, bridge, name, entry, guards)
        observations['automationEntry'] = name
        view = wait_for(lambda: project(bridge, 'automationMain'),
                        lambda v: v['createManually'], 30, 'automation main view')
        checks.append('original-automation-sidebar-entry-opened-the-page')
        before = dict(automations=automations_state(root), supplier=supplier_status(fixtures))
        observations['before'] = before
        observations['automationMain'] = {'cards': len(view['cards']), 'createManually': bool(view['createManually'])}

        if arguments.stop_after == 'page':
            return finish(profile, evidence, checks, observations, fixtures, bridge, guards, 'partial')

        # Create one automation through the original manual form.
        click(harness, bridge, 'create_manually', view['createManually'], guards)
        form = wait_for(lambda: project(bridge, 'createForm'),
                        lambda v: v['form']['present'] and v['form']['title'] and v['form']['prompt'], 30, 'manual create form')
        observations['createFormInitial'] = {'submit': form['form']['submit'], 'frequencyText': form['form']['frequencyText']}
        LAST['form-census'] = bridge.evaluate(TESTID_CENSUS)
        if arguments.stop_after == 'form':
            return finish(profile, evidence, checks, observations, fixtures, bridge, guards, 'partial')
        if form['form']['scheduleAdd']:
            click(harness, bridge, 'schedule_add', form['form']['scheduleAdd'], guards)
            if arguments.schedule == 'daily':
                option = wait_for(lambda: project(bridge, 'frequencyMenu'),
                                  lambda v: v['form']['dailyOption'], 20, 'daily frequency option')
                click(harness, bridge, 'frequency_daily', option['form']['dailyOption'], guards)
                checks.append('original-schedule-add-created-a-daily-schedule')
            else:
                option = wait_for(lambda: project(bridge, 'frequencyMenu'),
                                  lambda v: v['form']['customOption'], 20, 'custom frequency option')
                click(harness, bridge, 'frequency_custom', option['form']['customOption'], guards)
                dialog = wait_for(lambda: project(bridge, 'customRepeat'),
                                  lambda v: v['form']['unitSelect'] and v['form']['customConfirm'],
                                  20, 'custom repeat dialog')
                need(not dialog['form']['customConfirm']['disabled'],
                     'the custom repeat dialog was not confirmable')
                need(dialog['form']['unitSelect'] is not None, 'the custom repeat unit was not selectable')
                click(harness, bridge, 'custom_unit', dialog['form']['unitSelect'], guards)
                unit = wait_for(lambda: project(bridge, 'customUnitMenu'),
                                lambda v: v['form']['minuteOption'], 20, 'minute unit option')
                click(harness, bridge, 'custom_unit_minute', unit['form']['minuteOption'], guards)
                again = wait_for(lambda: project(bridge, 'customRepeatAgain'),
                                 lambda v: v['form']['customConfirm'], 20, 'custom repeat confirm')
                need(not again['form']['customConfirm']['disabled'],
                     'the custom repeat dialog was not confirmable')
                click(harness, bridge, 'custom_confirm', again['form']['customConfirm'], guards)
                checks.append('original-custom-repeat-dialog-set-an-every-minute-schedule')
        type_into(harness, bridge, lambda: project(bridge), 'title', 'G05e1 暂停恢复用例')
        type_into(harness, bridge, lambda: project(bridge), 'prompt', 'G05e1 受控自动化提示，不发送任何消息。')
        filled = wait_for(lambda: project(bridge, 'filledForm'),
                          lambda v: v['form']['titleValue'] and v['form']['promptValue'], 20, 'filled form values')
        need('G05e1 暂停恢复用例' in (filled['form']['titleValue'] or ''),
             'the title input did not receive the typed text')
        wait_for_minute_start()
        submit = wait_for(lambda: project(bridge, 'readyForm'),
                          lambda v: v['form']['submit'] and not v['form']['submit']['disabled'], 30, 'submit enabled')
        observations['createFormReady'] = {'frequencyText': submit['form']['frequencyText'],
                                           'titleValue': submit['form']['titleValue']}
        click(harness, bridge, 'submit_create', submit['form']['submit'], guards)
        cards = wait_for(lambda: project(bridge, 'afterCreate'),
                         lambda v: len(v['cards']) == 1 and v['cards'][0]['status'], 40, 'one created automation card')
        need(cards['cards'][0]['status'] == 'active', 'a new automation must start active')
        created = automations_state(root)
        need(len(created['automations']) == 1 and created['automations'][0]['enabled'] == 1,
             'the created automation was not persisted as enabled')
        need(created['automationRuns'] == 0 and created['automations'][0]['runCount'] == 0,
             'creating an automation must not dispatch any run')
        checks.append('persisted-one-enabled-automation-with-zero-runs')
        observations['afterCreate'] = {'status': cards['cards'][0]['status'], 'text': cards['cards'][0]['text'],
                                       'persisted': created['automations'][0], 'runs': created['automationRuns']}

        # Pause through the original card menu, then resume through the same control.
        # Pause, resume, then pause again before the first due. A paused task that is resumed
        # only after its due legitimately catches up with a real run, which this probe must not
        # cause, so every active moment stays clear of the due.
        paused = toggle(harness, bridge, guards, project, 'pause', 'paused')
        paused_state = automations_state(root)
        need(paused_state['automations'][0]['enabled'] == 0
             and paused_state['automations'][0]['lifecycleStatus'] == 'paused',
             'the pause action was not persisted on the automation')
        need(paused_state['automations'][0]['dispatchStatus'] == 'idle',
             'a paused automation must not be dispatching')
        need(paused_state['automationRuns'] == 0, 'pausing must not create a run')
        checks.append('original-pause-action-paused-the-automation')
        observations['paused'] = {'status': paused['status'], 'label': paused['label'], 'text': paused['text'],
                                  'persisted': paused_state['automations'][0]}

        resumed = toggle(harness, bridge, guards, project, 'resume', 'active')
        resumed_state = automations_state(root)
        need(resumed_state['automations'][0]['enabled'] == 1
             and resumed_state['automations'][0]['lifecycleStatus'] == 'active',
             'the resume action was not persisted on the automation')
        need(resumed_state['automationRuns'] == 0 and resumed_state['automations'][0]['runCount'] == 0,
             'resuming before the due must not dispatch a run')
        checks.append('original-resume-action-restored-the-active-state')
        observations['resumed'] = {'status': resumed['status'], 'label': resumed['label'], 'text': resumed['text'],
                                   'persisted': resumed_state['automations'][0]}

        paused_again = toggle(harness, bridge, guards, project, 'pause2', 'paused')
        hold_state = automations_state(root)
        need(hold_state['automations'][0]['enabled'] == 0 and hold_state['automationRuns'] == 0,
             'the second pause must stop the automation before its due')
        observations['pausedAgain'] = {'status': paused_again['status'], 'label': paused_again['label'],
                                       'text': paused_again['text'],
                                       'persisted': hold_state['automations'][0]}

        due = due_window(harness, bridge, guards, root, fixtures, hold_state, before)
        observations['pausedDue'] = due
        checks.append('paused-automation-crossed-its-real-due-without-dispatch')

        # Delete: first cancel must keep the card, then confirm must remove it.
        kept = delete(harness, bridge, guards, project, confirm=False)
        need(kept == 1, 'cancelling the delete dialog must keep the automation')
        kept_state = automations_state(root)
        need(len(kept_state['automations']) == 1, 'cancelling the delete dialog must keep the persisted automation')
        checks.append('original-delete-cancel-kept-the-automation')
        gone = delete(harness, bridge, guards, project, confirm=True)
        need(gone == 0, 'confirming the delete dialog must remove the automation')
        gone_state = automations_state(root)
        need(not gone_state['automations'], 'confirming the delete dialog must remove the persisted automation')
        checks.append('original-delete-confirm-removed-the-automation')
        after = supplier_status(fixtures)
        need(after['modelCalls'] == before['supplier']['modelCalls'],
             'the whole automation flow must not call any model')
        need(gone_state['automationRuns'] == 0, 'the whole automation flow must not dispatch any run')
        observations['delete'] = {'cardsAfterCancel': kept, 'cardsAfterConfirm': gone,
                                  'persistedAfterCancel': kept_state['automations'],
                                  'automationRuns': gone_state['automationRuns']}
        observations['metering'] = {'supplierCallsBefore': before['supplier']['modelCalls'],
                                   'supplierCallsAfter': after['modelCalls'],
                                   'automationRunsBefore': before['automations']['automationRuns'],
                                   'automationRunsAfter': gone_state['automationRuns']}
        checks.append('zero-model-calls-and-zero-runs-across-the-whole-flow')

        return finish(profile, evidence, checks, observations, fixtures, bridge, guards, 'passed')
    except Exception as error:  # first failure stops business and keeps the roots
        return finish(profile, evidence, checks, observations, fixtures, bridge,
                      None, 'failed', error)


TESTID_CENSUS = r"""(()=>{const seen=[];for(const e of document.querySelectorAll('[data-testid]')){if(e.getClientRects().length>0)seen.push(e.getAttribute('data-testid'));}
return {version:1,count:seen.length,ids:seen.slice(0,400)};})()"""


def advance_onboarding(first_run):
    """Walk the original onboarding with its own controls, never repeating a satisfied step."""
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


def wait_for_minute_start(max_seconds=70):
    """Create just after a whole minute so the first due stays away from the toggle tests."""
    deadline = time.monotonic() + max_seconds
    while time.monotonic() < deadline:
        if time.time() % 60 <= 8:
            return
        time.sleep(0.5)
    raise ProbeError('no whole-minute window opened for the create step')


def due_window(module, bridge, guards, root, fixtures, paused_state, before, cap_seconds=150):
    """Wait across the paused automation's real next_run_at and prove nothing dispatched.

    The probe fails when the schedule was not actually due inside the bounded window, so a
    far-away due can never be reported as "crossed its real due".
    """
    due_at = paused_state['automations'][0]['nextRunAt']
    need(isinstance(due_at, int), 'the paused automation lost its persisted schedule value')
    started = time.time() * 1000
    wait_seconds = min(cap_seconds, max(2.0, (due_at - started) / 1000 + 12))
    crossed = due_at <= started + wait_seconds * 1000
    time.sleep(wait_seconds)
    state = automations_state(root)
    supplier = supplier_status(fixtures)
    entry = state['automations'][0]
    need(state['automationRuns'] == 0, 'a paused automation dispatched a run at its due time')
    need(entry['runCount'] == 0 and entry['lastRunAt'] is None,
         'a paused automation recorded a run at its due time')
    need(entry['dispatchStatus'] == 'idle', 'a paused automation entered dispatch at its due time')
    need(supplier['modelCalls'] == before['supplier']['modelCalls'],
         'a paused automation called a model at its due time')
    need(crossed, 'the paused schedule was not due inside the bounded observation window')
    return {'dueAt': due_at, 'dueInMs': int(due_at - started), 'waitedMs': int(wait_seconds * 1000),
            'crossedRealDue': True, 'automationRuns': state['automationRuns'],
            'persisted': entry, 'supplierCalls': supplier['modelCalls']}


def automations_state(root):
    """Read-only view of the Host tasks database; never writes or takes a write lock."""
    path = root / 'data/.uwork/v2/tasks-index.sqlite'
    if not path.exists():
        return {'present': False}
    connection = sqlite3.connect(f'file:{path}?mode=ro', uri=True, timeout=5)
    try:
        connection.execute('PRAGMA query_only=1')
        columns = ('automationId', 'enabled', 'lifecycleStatus', 'runCount',
                   'nextRunAt', 'lastRunAt', 'dispatchStatus')
        rows = [dict(zip(columns, row)) for row in connection.execute(
            'SELECT automation_id,enabled,lifecycle_status,run_count,next_run_at,last_run_at,'
            'dispatch_status FROM automations ORDER BY automation_id')]
        runs = connection.execute('SELECT COUNT(*) FROM automation_runs').fetchone()[0]
    finally:
        connection.close()
    return {'present': True, 'automations': rows, 'automationRuns': runs}


def supplier_status(fixtures, wait=20):
    """One owned fixture status read: the controlled supplier call counter only."""
    start = len(fixtures.events)
    fixtures.send({'op': 'status'})
    deadline = time.monotonic() + wait
    while time.monotonic() < deadline:
        with fixtures.lock:
            rows = fixtures.events[start:]
        for row in rows:
            if 'modelCalls' in row:
                return {'modelCalls': row['modelCalls']}
        time.sleep(0.1)
    raise ProbeError('timeout waiting for the owned supplier status')


def type_into(module, bridge, read, field, value):
    """Click the field's current point, then insert real text input (never a JS value set)."""
    deadline = time.monotonic() + 20
    point = None
    while time.monotonic() < deadline:
        point = read()['form'][field]
        if point is not None and point['visible'] and point['hit']:
            break
        time.sleep(0.4)
    need(point is not None and point['visible'] and point['hit'],
         'text target was not clickable: ' + field)
    for kind in ('mousePressed', 'mouseReleased'):
        bridge.raw_cdp('Input.dispatchMouseEvent', type=kind, x=point['x'], y=point['y'],
                       button='left', clickCount=1)
    LAST['typing-' + field] = {'active': bridge.evaluate(
        "(()=>{const e=document.activeElement;return {tag:e?e.tagName:null,testid:e&&e.getAttribute?e.getAttribute('data-testid'):null,value:e&&e.value?String(e.value).slice(0,64):null};})()")}
    bridge.raw_cdp('Input.insertText', text=value)


def open_card_menu(module, bridge, guards, project, tag):
    view = wait_for(lambda: project(bridge, f'{tag}-card'),
                    lambda v: len(v['cards']) == 1 and v['cards'][0]['menu'], 20, f'{tag} card menu')
    click(module, bridge, f'open_menu_{tag}', view['cards'][0]['menu'], guards)
    return wait_for(lambda: project(bridge, f'{tag}-menu'),
                    lambda v: v['menu']['open'] and v['menu']['count'] == 1, 20, f'{tag} dropdown')


def toggle(module, bridge, guards, project, tag, expected):
    menu = open_card_menu(module, bridge, guards, project, tag)
    need(menu['menu']['toggle'] is not None, f'{tag}: no toggle control')
    click(module, bridge, f'{tag}_click', menu['menu']['toggle'], guards)
    cards = wait_for(lambda: project(bridge, f'{tag}-result'),
                     lambda v: len(v['cards']) == 1 and v['cards'][0]['status'] == expected,
                     30, f'{tag} state {expected}')
    return {'status': cards['cards'][0]['status'], 'label': menu['menu']['toggleLabel'],
            'text': cards['cards'][0]['text']}


def delete(module, bridge, guards, project, confirm):
    tag = 'delete_confirm' if confirm else 'delete_cancel'
    menu = open_card_menu(module, bridge, guards, project, tag)
    need(menu['menu']['delete'] is not None, f'{tag}: no delete control')
    click(module, bridge, f'{tag}_click', menu['menu']['delete'], guards)
    dialog = wait_for(lambda: project(bridge, f'{tag}-dialog'),
                      lambda v: v['dialog']['open'] and v['dialog']['confirm'], 20, f'{tag} dialog')
    target = dialog['dialog']['confirm'] if confirm else dialog['dialog']['cancel']
    need(target is not None, f'{tag}: no dialog control')
    click(module, bridge, f'{tag}_ok', target, guards)
    closed = wait_for(lambda: project(bridge, f'{tag}-closed'),
                      lambda v: not v['dialog']['open'] and len(v['cards']) == (0 if confirm else 1),
                      30, f'{tag} outcome')
    return len(closed['cards'])


def finish(profile, evidence, checks, observations, fixtures, bridge, guards, status, error=None):
    payload = dict(schema='g05e1-native-cdp-probe-v1', status=status, profile=profile,
                   boundary='real native fixture (isolated backend, real Electron/Host, original automation page); '
                            'CDP Input at real hit-tested points; not the reviewed Go/actor ceremony',
                   checks=checks, observations=observations,
                   actions=guards.journal() if guards else [],
                   lastObservations=LAST)
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
    if error is not None:
        print('LAST', json.dumps(LAST, ensure_ascii=False)[:2500])
    return 0 if status == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
