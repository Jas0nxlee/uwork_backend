#!/usr/bin/env python3
"""G04k fix verification probe on the real Native renderer (CDP, no OS-level input).

Reuses the reviewed phase modules read-only: the preparation leaf's ``ui.py`` and
``scripts/fixtures/native-first-run-ui.py`` for the original UI phases, and the v9
leaf's ``catalog.py`` for the model-menu census that reproduced the defect. Input is
dispatched with ``Input.dispatchMouseEvent`` at the element's real hit-tested point,
exactly as those modules do; no product module, React state or business response is
replaced.

This probe is not the reviewed Go/actor run: it does not claim that ceremony, and it
does not replace G04k acceptance by itself.
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, threading, time, runpy
from pathlib import Path

REPO = Path('/Users/ljp/Desktop/uwork_backend')
# v9 leaf carries the corrected reviewed phases (套餐模型 title, press/release only clicks).
PREP = REPO / 'evidence/client-native-two-organization-login-v9-preparation-20261019'
CENSUS_PREP = REPO / 'evidence/client-native-two-organization-login-v9-preparation-20261019'
NODE24 = '/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node'
ELECTRON = REPO / 'data/client-live-20261017/electron/Electron.app/Contents/MacOS/Electron'
BRIDGE = REPO / 'scripts/tests/native-cdp-bridge.mjs'


class ProbeError(Exception):
    pass


# Bounded public projections kept for diagnosis; never contains credentials.
LAST_OBSERVATIONS = {}


def need(value, message):
    if not value:
        raise ProbeError(message)


def expected_public(meta):
    """Same projection as the reviewed runtime.expected_public, from the same metadata."""
    result = {}
    for key in ('A', 'B'):
        slot = meta['twoOrganizationLogin']['slots'][key]
        credit = lambda n: format(n, ',') + ' Credit'  # noqa: E731
        result[key] = dict(
            organizationId=slot['organizationId'],
            identityName=slot['name'],
            company=slot['label'],
            department=slot['department'],
            role='member',
            model=slot['model'],
            modelId=slot['modelId'],
            allowance='当前可用额度：' + credit(slot['memberLimit'] - slot['creditBaseline']),
            usageRequests='0',
            usageSuccess='0%',
            usageCost=credit(slot['creditBaseline']),
            usageTokens='0',
            menus=slot['menus'],
            welcome=slot['welcome'],
            risk=slot['risk'],
        )
    return result


class Fixture:
    """Owned Common process: isolated backend, Electron Main and the real Host."""

    def __init__(self, profile, home, tmp, mode='two-organization', execute_b=False, packaged_manifest=None):
        need(mode in ('two-organization', 'experience', 'workflow'), 'unsupported fixture mode')
        dynamic_workflow = mode == 'workflow'
        self.profile, self.events, self.lock = profile, [], threading.Lock()
        self.child = subprocess.Popen(
            [NODE24, '--import', 'tsx', 'scripts/fixtures/client-native-enterprise.mjs'],
            cwd=REPO,
            env={
                'PATH': os.path.dirname(NODE24) + ':/usr/bin:/bin:/usr/sbin:/sbin',
                'HOME': str(home),
                'TMPDIR': str(tmp),
                'UWORK_NATIVE_FIXTURE_NAME': profile,
                'UWORK_NATIVE_CLIENT_EXPERIENCE': 'enabled',
                'UWORK_NATIVE_CONFIGURATION_WITNESS': 'enabled',
                **({'UWORK_NATIVE_TWO_ORGANIZATION_LOGIN': 'controlled'}
                   if mode == 'two-organization' else {}),
                **({'UWORK_NATIVE_TWO_ORGANIZATION_EXECUTION': 'controlled'} if execute_b else {}),
                **({'UWORK_NATIVE_PACKAGED_MANIFEST': str(packaged_manifest)} if packaged_manifest else {}),
                **({'UWORK_NATIVE_DYNAMIC_WORKFLOW_MODE': 'alwaysOn'} if dynamic_workflow else {}),
                'UWORK_NATIVE_ELECTRON': str(ELECTRON),
            },
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=self._drain_stderr, daemon=True).start()

    def _read(self):
        for line in self.child.stdout:
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except ValueError:
                continue
            with self.lock:
                self.events.append(value)

    def _drain_stderr(self):
        for line in self.child.stderr:
            if not re.search(r'ExperimentalWarning|trace-warnings', line):
                sys.stderr.write('fixture: ' + line[:400])

    def send(self, value):
        self.child.stdin.write(json.dumps(value) + '\n')
        self.child.stdin.flush()

    def wait_event(self, predicate, seconds, label):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            with self.lock:
                found = next((event for event in self.events if predicate(event)), None)
            if found:
                return found
            time.sleep(0.1)
        raise ProbeError('timeout waiting for ' + label)

    def command(self, op, seconds=30, **extra):
        start = len(self.events)
        self.send({'op': op, **extra})
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            with self.lock:
                rows = self.events[start:]
            for row in rows:
                if row.get('op') == op and row.get('status') == 'done':
                    return row
                if row.get('status') == 'fixture-command-failed':
                    raise ProbeError(op + ' rejected: ' + str(row.get('message'))[:120])
            time.sleep(0.1)
        raise ProbeError('timeout waiting for ' + op)


class Bridge:
    def __init__(self, port, renderer_prefix=None):
        self.ids, self.results, self.lock = 0, {}, threading.Lock()
        self.child = subprocess.Popen(
            [NODE24, str(BRIDGE), str(port), '1', *([renderer_prefix] if renderer_prefix else [])],
            cwd=REPO, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True,
        )
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=self._drain_stderr, daemon=True).start()
        info = self.call({'op': 'attach'})
        self.session = info['sessionId']
        self.target = info['url']

    def _read(self):
        for line in self.child.stdout:
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except ValueError:
                continue
            with self.lock:
                pending = self.results.get(value.get('id'))
            if pending is not None:
                pending.append(value)

    def _drain_stderr(self):
        for line in self.child.stderr:
            sys.stderr.write('bridge: ' + line[:400])

    def call(self, payload, seconds=20):
        self.ids += 1
        request_id = self.ids
        with self.lock:
            self.results[request_id] = []
        self.child.stdin.write(json.dumps({'id': request_id, **payload}) + '\n')
        self.child.stdin.flush()
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            with self.lock:
                found = self.results.get(request_id)
            if found:
                value = found[0]
                if value.get('error'):
                    raise ProbeError('cdp ' + str(value['error'])[:160])
                return value.get('result', {})
            time.sleep(0.02)
        raise ProbeError('cdp timeout')

    def evaluate(self, expression, seconds=20):
        result = self.call({
            'method': 'Runtime.evaluate',
            'sessionId': self.session,
            'params': {'expression': expression, 'returnByValue': True, 'awaitPromise': False},
        }, seconds)
        need('exceptionDetails' not in result, 'renderer evaluation failed')
        remote = result.get('result') or {}
        need(remote.get('type') == 'object' and isinstance(remote.get('value'), dict),
             'renderer projection was not an object')
        return remote['value']

    def raw_cdp(self, method, session_id=None, **params):
        return self.call({
            'method': method,
            'sessionId': session_id or self.session,
            'params': params,
        })


class Guards:
    """One-shot journal, auth lock and owned-root guard for the reviewed phase modules."""

    def __init__(self, evidence):
        self.claimed, self.locked, self.stopped = set(), False, False
        self.evidence = evidence

    def claim(self, step, starts_auth=False):
        if step in self.claimed:
            return False
        self.claimed.add(step)
        if starts_auth:
            self.locked = True
        return True

    def was_claimed(self, step):
        return step in self.claimed

    def auth_started(self):
        return self.locked

    def guard(self):
        return 1

    def budget(self):
        return None

    def journal(self):
        return sorted(self.claimed)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile', default='client-native-g04k-fix-20261019')
    parser.add_argument('--stop-after', default='b')
    parser.add_argument('--execute-b', action='store_true')
    arguments = parser.parse_args()
    profile = arguments.profile
    need(re.fullmatch(r'client-native-[a-z0-9-]+', profile), 'bad profile name')
    need(not arguments.execute_b or arguments.stop_after == 'b', 'execution requires the full A/B login flow')

    root, evidence = REPO / 'data' / profile, REPO / 'evidence' / profile
    for path in (root, evidence):
        need(not path.exists(), 'Use a fresh profile; previous evidence must not be overwritten')
    (evidence / 'controller-home').mkdir(parents=True, mode=0o700)
    (evidence / 'controller-tmp').mkdir(parents=True, mode=0o700)

    checks, observations = [], {}
    first, ui_module, catalog_module = (runpy.run_path(str(path)) for path in (
        REPO / 'scripts/fixtures/native-first-run-ui.py', CENSUS_PREP / 'ui.py', CENSUS_PREP / 'catalog.py'))

    fixture = None
    bridge = None
    try:
        fixture = Fixture(profile, evidence / 'controller-home', evidence / 'controller-tmp', execute_b=arguments.execute_b)
        ready = fixture.wait_event(lambda e: e.get('event') == 'ready', 180, 'ready')
        fixture.send({'op': 'launch'})
        launched = fixture.wait_event(lambda e: e.get('event') == 'launched', 120, 'launched')
        harness = runpy.run_path(str(REPO / 'scripts/tests/native-harness-bridge.py'))
        bridge = harness['HarnessBridge'](launched['cdpPort'], evidence=evidence)
        checks.append('owned-main-renderer-attached-over-loopback-cdp')

        meta = json.loads((evidence / 'desktop-state.json').read_text())
        need(meta['twoOrganizationLogin']['actualModelCallsPlanned'] == (2 if arguments.execute_b else 0), 'metadata changed')
        expected = expected_public(meta)
        guards = Guards(evidence)

        ui = ui_module['TwoOrganizationUi'](
            bridge.raw_cdp, bridge.session, guards.guard, guards.budget, guards.claim,
            guards.auth_started, guards.was_claimed, expected)
        first_run = first['FirstRunUi'](
            'primary-prelogin',
            lambda expression: bridge.evaluate(expression),
            bridge.raw_cdp, guards.guard, guards.budget, guards.claim, guards.auth_started)

        # 1. Original pre-login UI is mounted before any workspace exists.
        preworkspace = None
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            value = first_run.phase('observe')
            if value['loginVisible'] and not value['waiting'] and not value['nameVisible']:
                preworkspace = value
                break
            time.sleep(0.5)
        need(preworkspace is not None, 'preworkspace login page never became ready')
        checks.append('original-prelogin-page-visible-before-login')
        observations['preworkspace'] = {k: preworkspace[k] for k in ('step', 'loginVisible', 'waiting', 'nameVisible', 'onboardingVisible')}

        # 2. Owned workspace, then the original FirstRun actions.
        workspace = root / 'project-g04k-fix'
        workspace.mkdir(parents=True, mode=0o700)
        subprocess.run(['/usr/bin/git', 'init', '--quiet', str(workspace)], check=True)
        fixture.command('openWorkspace', 60, workspacePath=str(workspace))
        checks.append('owned-git-workspace-opened-through-the-original-command')

        for step in ('skip_login', 'select_developer', 'next_role', 'select_coding', 'next_mode', 'finish'):
            first_run.phase(step)
        ready_state = first_run.phase('observe')
        need(ready_state['ready'], 'workspace header and identity entry never became ready')
        first_run.phase('reopen_login')
        checks.append('original-first-run-seven-actions-and-reopen-login')
        observations['firstRun'] = {k: ready_state[k] for k in ('ready', 'step', 'loginVisible', 'entryVisible', 'workspaceHeaderVisible')}

        # 3. A signs in through the original UI, one controlled callback.
        ui.phase('select_A')
        ui.phase('login_A')
        deadline = time.monotonic() + 30
        pending = None
        while time.monotonic() < deadline:
            status = json.loads(json.dumps(fixture_status(fixture)))
            if status['held'] and status['pendingObserved'] and status['callbackCount'] == 0:
                pending = status
                break
            time.sleep(0.25)
        need(pending is not None, 'A never reached the held pre-callback state')
        fixture.send({'op': 'completeTwoOrganizationA'})
        deadline = time.monotonic() + 40
        authenticated = None
        while time.monotonic() < deadline:
            value = ui.phase('observe_A')
            if value['authenticated'] and value['identityNameMatches']:
                authenticated = value
                break
            time.sleep(0.5)
        need(authenticated is not None, 'A never became authenticated')
        # 身份提交和 Gateway 目录交付是不同异步事件；只观察当前原界面，不重复登录或选模。
        authenticated = observe_until(ui, 'observe_A',
            lambda v: v['authenticated'] and v['identityNameMatches'] and v['modelReady'],
            40, 'A authenticated model catalog ready')
        need(authenticated['modelReady'], 'A model was not ready')
        need(not authenticated['otherProjectionVisible'], 'A leaked another organization projection')
        checks.append('original-A-login-with-unique-controlled-callback')
        observations['A'] = {k: authenticated[k] for k in (
            'authenticated', 'identityNameMatches', 'modelReady', 'modelMatches', 'modelIdMatches', 'otherProjectionVisible')}

        # 4. Original menu and gateway reads, then back. The panel reads its usage
        # asynchronously, so the reviewed driver observes until the projection is complete.
        ui.phase('identity_menu_A')
        menu = observe_until(ui, 'observe_A', lambda v: v['identityMenuVisible'] and v['menuNameMatches'] and v['companyMatches'], 30, 'A identity menu')
        ui.phase('open_gateway_A')
        gateway = observe_until(ui, 'observe_A', lambda v: v['gatewayReady'], 60, 'A gateway view')
        need(gateway['gatewayReady'], 'A gateway view was not ready')
        ui.phase('back_A')
        observe_until(ui, 'observe_A', lambda v: v['authenticated'] and not v['settingsVisible'] and v['workspaceInteractive'], 30, 'A back on the workspace')
        checks.append('original-A-menu-and-gateway-reads')
        observations['gatewayA'] = {k: gateway[k] for k in (
            'gatewayReady', 'accountNameMatches', 'departmentMatches', 'roleMatches', 'allowanceMatches',
            'usageRequestsMatches', 'usageSuccessMatches', 'usageCostMatches', 'usageTokensMatches',
            'gatewayModelMatches', 'otherProjectionVisible')}

        # 5. Original logout through the same owner: reopen the menu, then the original action.
        ui.phase('identity_menu_logout_A')
        observe_until(ui, 'observe_A', lambda v: v['identityMenuVisible'] and v['menuNameMatches'] and v['companyMatches'], 30, 'A identity menu before logout')
        ui.phase('logout_A')
        # Same public boundary as the reviewed driver's signed-out stage: a stale
        # projection may still be visible here, and the census below is what judges it.
        signed_out = observe_until(ui, 'observe_B', lambda v: v['signedOut'] and not v['authenticated'] and not v['settingsVisible'] and not v['identityMenuVisible'], 30, 'signed-out view')
        checks.append('original-A-logout-signed-out')
        observations['signedOut'] = {k: signed_out[k] for k in (
            'signedOut', 'authenticated', 'identityMenuVisible', 'otherProjectionVisible',
            'otherProjectionFields')}

        # 6. The G04k regression: the original model menu must offer no revoked candidate.
        catalog = catalog_module['CatalogUi'](
            bridge.raw_cdp, bridge.session, guards.guard, guards.budget, guards.claim,
            guards.auth_started, guards.was_claimed, expected)
        raw_census, _ = catalog.observe()
        LAST_OBSERVATIONS['catalogBeforeOpen'] = raw_census
        catalog.phase('catalog_signedout_observe')
        opened = catalog.phase('catalog_open_signedout')
        raw_opened, view_opened = catalog.observe()
        LAST_OBSERVATIONS['catalogOpened'] = raw_opened
        # 该诊断只在 DOM 真的提供 UCAS 子分组时才执行展开动作；不为了动作成功而跳过断言。
        if view_opened['canExpandUcas']:
            census = catalog.phase('catalog_expand_ucas')
            observations['catalogPath'] = 'expanded-ucas-group'
        else:
            census = dict(opened, **{k: view_opened[k] for k in view_opened if k != 'phase'})
            observations['catalogPath'] = 'no-ucas-group-on-the-opened-popup'
        comparison = catalog_module['assert_census'](census)
        # The census intentionally leaves the popup open; closing it is an explicit probe
        # action (Escape), not part of the reviewed census scope, and is recorded below.
        press_escape(bridge)
        closed = None
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            raw_after, _ = catalog.observe()
            if raw_after['popupCount'] == 0:
                closed = raw_after
                break
            time.sleep(0.25)
        need(closed is not None, 'the model popup never closed before the B leg')
        checks.append('signed-out-model-popup-closed-with-escape-before-B')
        checks.append('signed-out-model-menu-census-has-no-revoked-candidate')
        observations['catalog'] = {k: census[k] for k in (
            'popupVisible', 'popupOwnerVerified', 'anchorComposer', 'censusComplete',
            'totalModelItems', 'exactAItems', 'selectableAItems', 'exactBItems', 'selectableBItems', 'unknownItems')}
        observations['censusVerdict'] = comparison

        if arguments.stop_after != 'census':
            # 7. B re-authenticates on the same profile and must see only its own projection.
            ui.phase('open_login_B')
            observe_until(ui, 'observe_B', lambda v: v['loginVisible'] and not v['waiting'] and not v['otherProjectionVisible'], 30, 'B login page')
            ui.phase('select_B')
            ui.phase('login_B')
            deadline = time.monotonic() + 30
            pending_b = None
            while time.monotonic() < deadline:
                status_b = fixture_status(fixture)
                if (status_b['slot'] == 'B' and status_b['held'] and status_b['pendingObserved']
                        and status_b['callbackCount'] == 0):
                    pending_b = status_b
                    break
                time.sleep(0.25)
            need(pending_b is not None, 'B never reached the held pre-callback state')
            fixture.send({'op': 'completeTwoOrganizationB'})
            authenticated_b = observe_until(
                ui, 'observe_B',
                lambda v: v['authenticated'] and v['identityNameMatches'] and not v['otherProjectionVisible'],
                40, 'B authenticated projection')
            checks.append('original-B-reauthentication-with-unique-controlled-callback')
            observations['B'] = {k: authenticated_b[k] for k in (
                'authenticated', 'identityNameMatches', 'modelReady', 'modelMatches', 'modelIdMatches',
                'otherProjectionVisible', 'otherProjectionFields')}
            ui.phase('identity_menu_B')
            observe_until(ui, 'observe_B', lambda v: v['identityMenuVisible'] and v['menuNameMatches'] and v['companyMatches'], 30, 'B identity menu')
            ui.phase('open_gateway_B')
            gateway_b = observe_until(ui, 'observe_B', lambda v: v['gatewayReady'], 60, 'B gateway view')
            checks.append('original-B-menu-and-gateway-reads')
            # Close the settings panel through its own control before reading the composer menu.
            panel = ui.phase('observe_B')
            if panel['settingsVisible'] and panel['controls']['back']:
                click_point(bridge, panel['controls']['back'])
                observe_until(ui, 'observe_B',
                              lambda v: not v['settingsVisible'] and v['workspaceInteractive'],
                              30, 'B back on the workspace')
            b_census = b_catalog_census(catalog, catalog_module, bridge, expected, press_escape)
            checks.append('B-model-menu-offers-its-own-model-and-no-revoked-one')
            observations['Bcatalog'] = b_census
            observations['gatewayB'] = {k: gateway_b[k] for k in (
                'gatewayReady', 'accountNameMatches', 'departmentMatches', 'roleMatches', 'allowanceMatches',
                'usageRequestsMatches', 'usageSuccessMatches', 'usageCostMatches', 'usageTokensMatches',
                'gatewayModelMatches', 'otherProjectionVisible')}

            if arguments.execute_b:
                execute = runpy.run_path(str(REPO / 'scripts/tests/native-g04k-execution-ui.py'))
                observations['Bexecution'] = execute['execute_b'](
                    bridge, fixture, fixture_status, catalog, catalog_module, expected, evidence)
                checks.extend(['original-B-model-selection-and-composer-send',
                               'B-response-visible-and-current-run-terminal',
                               'A-ledger-unchanged-B-only-new-model-accounting'])

        status = 'passed' if (arguments.stop_after != 'census' or checks) and (arguments.stop_after != 'b' or observations.get('B')) else 'partial'
        payload = dict(
            schema='g04k-fix-native-cdp-probe-v1', status=status, profile=profile,
            boundary='real isolated backend HTTPS/TCP, real Electron Main and Host, original renderer DOM; '
                     'CDP Input.dispatchMouseEvent at real hit-tested points; reviewed phase modules reused read-only; '
                     'not the reviewed Go/actor ceremony and not a replacement for G04k acceptance',
            checks=checks, observations=observations, actions=guards.journal(),
            modelCallsClaimed=observations.get('Bexecution', {}).get('modelCalls', 0),
            desktopArtifacts={name: hashlib.sha256((REPO / 'clients/uwork/packages/desktop/out' / name).read_bytes()).hexdigest()
                              for name in ('host/index.js', 'main/index.js')},
            modelIdExpected={slot: expected[slot]['modelId'] for slot in ('A', 'B')},
        )
    except Exception as error:  # first failure stops business and keeps the roots
        payload = dict(schema='g04k-fix-native-cdp-probe-v1', status='failed', profile=profile,
                       checks=checks, observations=observations,
                       lastObservations=LAST_OBSERVATIONS,
                       failure=type(error).__name__ + ': ' + str(error)[:400],
                       failureCode=getattr(error, 'code', None),
                       failureClass=type(error).__name__)
    finally:
        try:
            if fixture:
                fixture.command('stopNative', 25)
        except Exception:
            pass
        if bridge:
            bridge.kill()
        if fixture:
            fixture.child.terminate()
            try:
                fixture.child.wait(timeout=25)
            except subprocess.TimeoutExpired:
                fixture.child.kill()
                fixture.child.wait(timeout=5)
            payload['fixtureExitCode'] = fixture.child.returncode
            if fixture.child.returncode != 0:
                payload['businessChecksPassed'] = payload.get('status') == 'passed'
                payload['status'] = 'failed'
                payload['failureCode'] = 'OWNED_FIXTURE_SHUTDOWN_FAILED'
            else:
                cleanup = json.loads((evidence / 'cleanup.json').read_text())
                payload['cleanup'] = cleanup
                if cleanup['errors'] or not cleanup['serversClosed'] or not cleanup['electronExited']:
                    payload['status'] = 'failed'
                    payload['failureCode'] = 'OWNED_FIXTURE_RESOURCES_REMAIN'
        (evidence / 'probe-result.json').write_text(json.dumps(payload, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        os.chmod(evidence / 'probe-result.json', 0o600)
    print(json.dumps({k: payload[k] for k in payload if k != 'observations'}, ensure_ascii=False, indent=1))
    print('OBSERVATIONS', json.dumps(payload.get('observations', {}), ensure_ascii=False))
    return 0 if payload['status'] == 'passed' else 1


def click_point(bridge, point):
    need(point is not None and point['visible'] and point['hit'] and not point['disabled'],
         'census control was not clickable')
    for kind in ('mousePressed', 'mouseReleased'):
        bridge.raw_cdp('Input.dispatchMouseEvent', type=kind, x=point['x'], y=point['y'],
                       button='left', clickCount=1)


def b_catalog_census(catalog, module, bridge, expected, escape):
    """Same reviewed projection as the signed-out census, asserting the signed-in owner's own model."""
    raw, view = catalog.observe()
    for _ in range(4):
        if raw['popupCount'] == 0 and raw['triggerVisible'] and not raw['triggerDisabled']:
            break
        escape(bridge)
        time.sleep(0.5)
        raw, view = catalog.observe()
    need(raw['popupCount'] == 0 and raw['triggerVisible'] and not raw['triggerDisabled'] and view['anchorComposer'],
         'B model trigger was not controllable')
    click_point(bridge, view['controls']['model'])
    raw, view = catalog.observe()
    if view['canExpandUcas']:
        click_point(bridge, view['controls']['ucas'])
        raw, view = catalog.observe()
    need(raw['popupCount'] == 1, 'B model popup did not open')
    a_id, b_id = (module['item_id'](expected[slot]['modelId']) for slot in ('A', 'B'))
    selectable = lambda item: (item['kind'] == 'dropdown-menu-radio-item'  # noqa: E731
                               and not item['locked'] and not item['disabled'])
    census = dict(
        totalModelItems=len(raw['items']),
        exactAItems=sum(i['id'] == a_id for i in raw['items']),
        exactBItems=sum(i['id'] == b_id for i in raw['items']),
        selectableBItems=sum(i['id'] == b_id and selectable(i) for i in raw['items']),
        providerGroups=len(raw['groups']),
    )
    escape(bridge)
    need(census['exactAItems'] == 0, 'the revoked organization model was still offered to B')
    need(census['exactBItems'] >= 1 and census['selectableBItems'] >= 1,
         'B did not get its own selectable model')
    return census


def press_escape(bridge):
    """One explicit Escape key sequence on the owned renderer's focused element."""
    for kind in ('keyDown', 'keyUp'):
        bridge.raw_cdp('Input.dispatchKeyEvent', type=kind, key='Escape', code='Escape', windowsVirtualKeyCode=27, nativeVirtualKeyCode=27)


def observe_until(module, step, predicate, seconds, label):
    """Bounded read-only observation; never repeats a business action."""
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = module.phase(step)
        if predicate(last):
            return last
        time.sleep(0.5)
    LAST_OBSERVATIONS[label] = last
    raise ProbeError('observation never matched: ' + label)


def fixture_status(fixture):
    """One owned status read; only fixed public fields leave this process."""
    start = len(fixture.events)
    fixture.send({'op': 'primaryLoginStatus'})
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        with fixture.lock:
            rows = fixture.events[start:]
        for row in rows:
            if 'dual' in row:
                return row
        time.sleep(0.1)
    raise ProbeError('timeout waiting for primaryLoginStatus')


if __name__ == '__main__':
    sys.exit(main())
