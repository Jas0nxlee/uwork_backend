"""Pure ports and Node VM only: no Native/BH/backend/network or runtime root."""
from pathlib import Path
import copy
import importlib.util
import json
import shutil
import subprocess
import unittest

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('first_run_ui', HERE / 'native-first-run-ui.py')
ui = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ui)


def projection():
    value = dict.fromkeys(ui.FLAGS, False)
    value.update(version=1, invalid=False, step='role', onboardingVisible=True,
                 loginVisible=True, controls=dict.fromkeys(ui.CONTROLS))
    return value


class Fixture:
    def __init__(self, mode='primary-prelogin'):
        self.mode, self.raw = mode, projection()
        self.locked = mode == 'file-restored'
        self.raw['loginVisible'] = not self.locked
        self.used, self.events = set(), []
        self.budget_ok, self.guard_calls, self.change_at = True, 0, None
        self.fail_input = False
        self.refresh_controls()

    def refresh_controls(self):
        self.raw['controls'] = dict.fromkeys(ui.CONTROLS)
        active = []
        if self.raw['loginVisible']:
            active = ['skip_login']
        elif self.raw['onboardingVisible']:
            active = {'role': ['developer', 'next_role'], 'mode': ['coding', 'next_mode'],
                      'preferences': ['finish']}.get(self.raw['step'], [])
        elif self.raw['entryVisible']:
            active = ['reopen_login']
        for key in active:
            self.raw['controls'][key] = {'x': 10 + ui.CONTROLS.index(key) * 20, 'y': 20,
                                        'visible': True, 'hit': True, 'disabled': False}

    def guard(self):
        self.guard_calls += 1
        return 2 if self.change_at and self.guard_calls >= self.change_at else 1

    def budget(self):
        if not self.budget_ok:
            raise RuntimeError('private budget detail')

    def claim(self, step, starts_auth=False):
        assert step.startswith('first_run_') and starts_auth is False
        if step in self.used:
            return False
        self.used.add(step)
        self.events.append(('claim', step))
        return True

    def js(self, expression):
        assert expression == ui.PUBLIC_DOM
        return copy.deepcopy(self.raw)

    def cdp(self, method, **parameters):
        assert method == 'Input.dispatchMouseEvent'
        self.events.append((method, parameters))
        if self.fail_input:
            raise RuntimeError('proof=must-not-escape token=private')
        if parameters['type'] != 'mouseReleased':
            return {}
        control = ui.CONTROLS[(parameters['x'] - 10) // 20]
        if control == 'skip_login':
            self.raw['loginVisible'] = False
        elif control == 'developer':
            self.raw['developerSelected'] = True
        elif control == 'next_role':
            self.raw['step'] = 'mode'
        elif control == 'coding':
            self.raw['codingSelected'] = True
        elif control == 'next_mode':
            self.raw.update(step='preferences', memoryUnchecked=True,
                            migrationUnchecked=True, preferencesSafe=True)
        elif control == 'finish':
            self.raw.update(step='none', onboardingVisible=False, workspaceHeaderVisible=True,
                            entryVisible=self.mode == 'primary-prelogin',
                            nameVisible=self.mode == 'file-restored')
        elif control == 'reopen_login':
            self.raw['loginVisible'] = True
        self.refresh_controls()
        return {}

    def actor(self):
        return ui.FirstRunUi(self.mode, self.js, self.cdp, self.guard, self.budget,
                             self.claim, lambda: self.locked)

    def clicks(self):
        return [event for event in self.events if event[0] == 'Input.dispatchMouseEvent']


class Contracts(unittest.TestCase):
    def test_primary_original_sequence_claims_before_physical_input_without_auth_or_preference_changes(self):
        f = Fixture()
        for step in ui.PRIMARY_STEPS:
            value = f.actor().phase(step)
            self.assertTrue(value['inputDispatched'])
        self.assertEqual(len(f.clicks()), 7 * 3)
        self.assertFalse(f.locked)
        self.assertTrue(f.raw['memoryUnchecked'] and f.raw['migrationUnchecked'])
        self.assertEqual(f.used, {'first_run_' + step for step in ui.PRIMARY_STEPS})
        for index, event in enumerate(f.events):
            if event[0] == 'Input.dispatchMouseEvent' and event[1]['type'] == 'mouseMoved':
                self.assertEqual(f.events[index - 1][0], 'claim')
        self.assertTrue(value['loginVisible'])
        self.assertFalse(value['ready'])

    def test_file_restored_only_onboards_and_finishes_with_header_and_original_identity_name(self):
        f = Fixture('file-restored')
        for step in ui.ONBOARDING_STEPS:
            value = f.actor().phase(step)
        self.assertTrue(value['ready'] and value['workspaceHeaderVisible'] and value['nameVisible'])
        self.assertFalse(value['entryVisible'])
        self.assertTrue(f.locked)
        self.assertEqual(len(f.clicks()), 5 * 3)
        for step in ('skip_login', 'reopen_login', 'logout', 'login_once', 'raw_js'):
            with self.assertRaises(ui.FirstRunUiError):
                f.actor().phase(step)
        self.assertEqual(len(f.clicks()), 15)

    def test_forward_buttons_require_actual_step_and_selected_role_or_mode(self):
        for step in ('next_mode', 'finish', 'select_coding', 'next_role'):
            f = Fixture('file-restored')
            with self.assertRaises(ui.FirstRunUiError):
                f.actor().phase(step)
            self.assertFalse(f.clicks())
        f = Fixture('file-restored')
        f.raw.update(step='mode', codingSelected=False)
        f.refresh_controls()
        with self.assertRaises(ui.FirstRunUiError):
            f.actor().phase('next_mode')
        self.assertFalse(f.clicks())

    def test_skip_requires_unstarted_preauth_and_never_cancels_or_restarts_identity(self):
        for key in ('waiting', 'nameVisible'):
            f = Fixture(); f.raw[key] = True
            with self.assertRaises(ui.FirstRunUiError):
                f.actor().phase('skip_login')
            self.assertFalse(f.clicks())
        f = Fixture(); f.locked = True
        with self.assertRaises(ui.FirstRunUiError):
            f.actor().phase('skip_login')
        self.assertFalse(f.clicks())

    def test_persistent_duplicate_claim_stops_a_new_actor_before_input(self):
        f = Fixture('file-restored')
        f.actor().phase('select_developer')
        with self.assertRaises(ui.FirstRunUiError):
            f.actor().phase('select_developer')
        self.assertEqual(len(f.clicks()), 3)

    def test_finish_refuses_checked_or_unknown_preferences_and_does_not_toggle_any_checkbox(self):
        for key in ('memoryUnchecked', 'migrationUnchecked', 'preferencesSafe'):
            f = Fixture('file-restored')
            f.raw.update(step='preferences', memoryUnchecked=True,
                         migrationUnchecked=True, preferencesSafe=True)
            f.raw[key] = False
            f.refresh_controls()
            with self.assertRaises(ui.FirstRunUiError):
                f.actor().phase('finish')
            self.assertFalse(f.clicks())

    def test_missing_composer_is_not_readiness_and_identity_gate_differs_by_mode(self):
        for mode in ui.MODES:
            f = Fixture(mode)
            f.raw.update(step='none', onboardingVisible=False, loginVisible=False)
            f.refresh_controls()
            self.assertFalse(f.actor().phase('observe')['ready'])
            f.raw.update(workspaceHeaderVisible=True, entryVisible=mode == 'primary-prelogin',
                         nameVisible=mode == 'file-restored')
            self.assertTrue(f.actor().phase('observe')['ready'])
            f.raw['startupLoadingVisible'] = True
            self.assertFalse(f.actor().phase('observe')['ready'])

    def test_budget_owner_geometry_and_unknown_payloads_fail_closed_without_raw_details(self):
        f = Fixture('file-restored'); f.budget_ok = False
        with self.assertRaises(ui.FirstRunUiError):
            f.actor().phase('select_developer')
        f = Fixture('file-restored'); f.change_at = 3
        with self.assertRaises(ui.FirstRunUiError):
            f.actor().phase('select_developer')
        self.assertFalse(f.clicks())
        for value in (True, float('nan'), -1, 20000):
            f = Fixture('file-restored'); f.raw['controls']['developer']['x'] = value
            with self.assertRaises(ui.FirstRunUiError):
                f.actor().phase('select_developer')
        f = Fixture(); f.raw['proof'] = 'private'
        with self.assertRaisesRegex(ui.FirstRunUiError, '^FIRST_RUN_PHASE_FAILED_RAW_DETAILS_WITHHELD$'):
            f.actor().phase('observe')
        f = Fixture(); f.fail_input = True
        with self.assertRaises(ui.FirstRunUiError) as raised:
            f.actor().phase('skip_login')
        self.assertNotIn('private', str(raised.exception))

    def test_root_change_during_js_or_after_mouse_move_cannot_release_ready_or_later_frames(self):
        with self.subTest(stage='projection'):
            f = Fixture('file-restored')
            f.raw.update(step='none', onboardingVisible=False, workspaceHeaderVisible=True,
                         loginVisible=False, nameVisible=True)
            def change_during_js(expression):
                value = f.js(expression)
                f.change_at = f.guard_calls + 1
                return value
            actor = ui.FirstRunUi(f.mode, change_during_js, f.cdp, f.guard, f.budget,
                                  f.claim, lambda: f.locked)
            with self.assertRaises(ui.FirstRunUiError):
                actor.phase('observe')
            self.assertFalse(f.clicks())
        with self.subTest(stage='input-frames'):
            f = Fixture('file-restored')
            def change_after_move(method, **parameters):
                value = f.cdp(method, **parameters)
                if parameters['type'] == 'mouseMoved':
                    f.change_at = f.guard_calls + 1
                return value
            actor = ui.FirstRunUi(f.mode, f.js, change_after_move, f.guard, f.budget,
                                  f.claim, lambda: f.locked)
            with self.assertRaises(ui.FirstRunUiError):
                actor.phase('select_developer')
            self.assertEqual([event[1]['type'] for event in f.clicks()], ['mouseMoved'])

    def test_fixed_projection_has_real_node24_syntax_and_exact_step_scoped_forward_controls(self):
        node = shutil.which('node')
        self.assertIsNotNone(node)
        version = subprocess.run([node, '--version'], check=True, capture_output=True, text=True).stdout.strip()
        self.assertTrue(version.startswith('v24.'), version)
        program = r'''const vm=require('node:vm'),values=[];
        for(let step=0;step<3;step++){
          let hit=null;
          const make=(text='',attrs={},shown=true)=>({textContent:text,hidden:!shown,disabled:false,map:{},
            querySelectorAll(s){return this.map[s]??[]},getAttribute(k){return attrs[k]??null},
            getClientRects(){return shown?[{}]:[]},getBoundingClientRect(){hit=this;return{left:0,top:0,right:100,bottom:40}},contains(e){return e===this}});
          const page=make(),progress=make(),group=make(),forward=make(step===2?'开始使用':'下一步');
          progress.map[':scope > li']=[0,1,2].map(i=>make('',{'aria-current':i===step?'step':null}));
          page.map['header > ol']=[progress];
          page.map.h1=[make(['你的主要工作方向是？','选择适合你的 UI 模式','选择你的工作助手偏好'][step])];
          page.map['footer button']=[make('跳过'),forward];
          if(step<2){const choice=make('',{'aria-pressed':'true'});choice.map[step===0?':scope > span:not([aria-hidden="true"])':':scope > span > span:first-child']=[make(step===0?'软件开发/数据/AI':'开发')];group.map[':scope > button']=[choice];page.map['[role="group"]']=[group];}
          if(step===2)page.map['[role="checkbox"][data-slot="checkbox"]']=['开启工作区记忆','迁移会话数据'].map(label=>{const box=make('',{'aria-checked':'false'}),parent=make();parent.map[':scope > span.font-medium']=[make(label)];box.closest=()=>parent;return box;});
          const doc={querySelectorAll:s=>s==='[data-testid="onboarding-page"]'?[page]:[],elementFromPoint:()=>hit};
          Object.defineProperty(doc,'body',{get(){throw Error('body forbidden')}});
          const context={document:doc,innerWidth:1000,innerHeight:800};
          for(const key of ['location','localStorage','sessionStorage','fetch','XMLHttpRequest'])Object.defineProperty(context,key,{get(){throw Error('private surface forbidden')}});
          values.push(vm.runInNewContext(SOURCE,context));
        }process.stdout.write(JSON.stringify(values));'''.replace('SOURCE', json.dumps(ui.PUBLIC_DOM))
        result = subprocess.run([node, '-e', program], check=True, capture_output=True, text=True)
        values = [ui.validate_projection(value) for value in json.loads(result.stdout)]
        for index, key in enumerate(('next_role', 'next_mode', 'finish')):
            self.assertIsNotNone(values[index]['controls'][key])
            self.assertEqual(sum(values[index]['controls'][other] is not None for other in ('next_role', 'next_mode', 'finish')), 1)
        self.assertTrue(values[2]['preferencesSafe'])


if __name__ == '__main__':
    unittest.main()
