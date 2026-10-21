"""Definitions only: original first-run UI, fixed public projection and physical Input."""
import json
import math

SCHEMA = 'native-first-run-ui-v1'
MODES = ('primary-prelogin', 'file-restored')
ONBOARDING_STEPS = ('select_developer', 'next_role', 'select_coding', 'next_mode', 'finish')
PRIMARY_STEPS = ('skip_login', *ONBOARDING_STEPS, 'reopen_login')
CONTROLS = ('skip_login', 'developer', 'next_role', 'coding', 'next_mode', 'finish', 'reopen_login')
FLAGS = ('startupLoadingVisible', 'onboardingVisible', 'workspaceHeaderVisible', 'loginVisible',
         'waiting', 'entryVisible', 'nameVisible', 'developerSelected', 'codingSelected',
         'memoryUnchecked', 'migrationUnchecked', 'preferencesSafe', 'errorVisible')
DIAGNOSTIC_CAUSES = frozenset((
    'ACTION_ALREADY_USED', 'CODING_REQUIRED', 'CONTROL_KEYS', 'CONTROL_NOT_READY',
    'DEFAULT_FALSE_PREFERENCES_REQUIRED', 'DEVELOPER_REQUIRED', 'EARLIER_FAILURE',
    'HEADER_AND_ENTRY_REQUIRED', 'MODE_NOT_ALLOWED', 'ONBOARDING_REQUIRED',
    'OWNED_ROOT_REQUIRED', 'PHASE_NOT_ALLOWED', 'POINT_FLAGS', 'POINT_KEYS', 'POINT_NUMBER',
    'PRIMARY_PREAUTH_ONLY', 'PRIVACY_LOCK_REQUIRED', 'PUBLIC_BOUND', 'PUBLIC_KEYS',
    'PUBLIC_STEP', 'PUBLIC_VERSION', 'ROOT_CHANGED_BEFORE_INPUT', 'ROOT_CHANGED_DURING_INPUT',
    'ROOT_CHANGED_DURING_OBSERVATION', 'UNSTARTED_LOGIN_REQUIRED', 'WRONG_ONBOARDING_STEP',
))

PUBLIC_DOM = r'''(()=>{
  let invalid=false;
  const list=(s,b=document,n=32)=>{const a=Array.from(b?.querySelectorAll(s)??[]);if(a.length>n){invalid=true;return [];}return a;};
  const one=(s,b=document)=>{const a=list(s,b);if(a.length>1)invalid=true;return a.length===1?a[0]:null;};
  const get=id=>one('[data-testid="'+id+'"]');
  const text=(e,n=128)=>{if(!e)return null;const t=(e.textContent??'').replace(/\s+/g,' ').trim();if(t.length>n){invalid=true;return null;}return t;};
  const visible=e=>!!e&&!e.hidden&&e.getClientRects().length>0;
  const point=e=>{if(!visible(e))return null;const r=e.getBoundingClientRect(),l=Math.max(0,r.left),t=Math.max(0,r.top),z=Math.min(innerWidth,r.right),b=Math.min(innerHeight,r.bottom);if(z<=l||b<=t)return null;const x=(l+z)/2,y=(t+b)/2,h=document.elementFromPoint(x,y);return{x,y,visible:true,hit:!!h&&(h===e||e.contains(h)),disabled:e.disabled===true||e.getAttribute('aria-disabled')==='true'};};
  const unique=a=>{if(a.length>1)invalid=true;return a.length===1?a[0]:null;};
  const page=get('onboarding-page'),shown=visible(page);
  const progress=one('header > ol',page),items=list(':scope > li',progress,3);
  const current=items.map((e,i)=>e.getAttribute('aria-current')==='step'?i:-1).filter(i=>i>=0);
  const index=shown&&items.length===3&&current.length===1?current[0]:-1;
  const titles=['你的主要工作方向是？','选择适合你的 UI 模式','选择你的工作助手偏好'];
  const step=index>=0&&text(one('h1',page))===titles[index]?['role','mode','preferences'][index]:(shown?'unknown':'none');
  const group=one('[role="group"]',page),options=list(':scope > button',group,16);
  const developer=step==='role'?unique(options.filter(e=>text(one(':scope > span:not([aria-hidden="true"])',e))==='软件开发/数据/AI')):null;
  const coding=step==='mode'?unique(options.filter(e=>text(one(':scope > span > span:first-child',e))==='开发')):null;
  const forward=unique(list('footer button',page,4).filter(e=>text(e,32)===(step==='preferences'?'开始使用':'下一步')));
  const boxes=list('[role="checkbox"][data-slot="checkbox"]',page,3);
  const checkbox=label=>unique(boxes.filter(e=>text(one(':scope > span.font-medium',e.closest('label')),32)===label));
  const memory=step==='preferences'?checkbox('开启工作区记忆'):null,migration=step==='preferences'?checkbox('迁移会话数据'):null;
  const unchecked=e=>visible(e)&&e.getAttribute('aria-checked')==='false';
  const name=get('enterprise-identity-name');
  return{version:1,invalid,step,startupLoadingVisible:visible(get('root-startup-loading')),onboardingVisible:shown,
    workspaceHeaderVisible:visible(get('workspace-mode-header')),loginVisible:visible(get('enterprise-login-page')),
    waiting:visible(get('enterprise-login-qr-surface')),entryVisible:visible(get('enterprise-identity-entry')),
    nameVisible:visible(name)&&!!text(name),developerSelected:!!developer&&developer.getAttribute('aria-pressed')==='true',
    codingSelected:!!coding&&coding.getAttribute('aria-pressed')==='true',memoryUnchecked:unchecked(memory),migrationUnchecked:unchecked(migration),
    preferencesSafe:boxes.length===2&&unchecked(memory)&&unchecked(migration),errorVisible:visible(one('[role="alert"]',page)),
    controls:{skip_login:point(get('enterprise-login-skip')),developer:point(developer),next_role:step==='role'?point(forward):null,
      coding:point(coding),next_mode:step==='mode'?point(forward):null,finish:step==='preferences'?point(forward):null,
      reopen_login:point(get('enterprise-identity-entry'))}};
})()'''


class FirstRunUiError(AssertionError):
    pass


def require(condition, code):
    if not condition:
        raise FirstRunUiError('FIRST_RUN_' + code)


def validate_projection(value):
    require(type(value) is dict and set(value) == {'version', 'invalid', 'step', 'controls', *FLAGS}, 'PUBLIC_KEYS')
    require(type(value['version']) is int and value['version'] == 1 and type(value['invalid']) is bool and not value['invalid'], 'PUBLIC_VERSION')
    require(len(json.dumps(value).encode()) <= 8192 and all(type(value[k]) is bool for k in FLAGS), 'PUBLIC_BOUND')
    require(value['step'] in ('none', 'role', 'mode', 'preferences', 'unknown'), 'PUBLIC_STEP')
    require(type(value['controls']) is dict and set(value['controls']) == set(CONTROLS), 'CONTROL_KEYS')
    for point in value['controls'].values():
        if point is None:
            continue
        require(type(point) is dict and set(point) == {'x', 'y', 'visible', 'hit', 'disabled'}, 'POINT_KEYS')
        require(all(type(point[k]) in (int, float) and math.isfinite(point[k]) and 0 <= point[k] <= 16384 for k in ('x', 'y')), 'POINT_NUMBER')
        require(all(type(point[k]) is bool for k in ('visible', 'hit', 'disabled')), 'POINT_FLAGS')
    return value


class FirstRunUi:
    def __init__(self, mode, raw_js, raw_cdp, owned_guard, action_budget, claim_once, auth_started):
        require(mode in MODES, 'MODE_NOT_ALLOWED')
        self.__mode, self.__js, self.__cdp = mode, raw_js, raw_cdp
        self.__guard, self.__budget, self.__claim = owned_guard, action_budget, claim_once
        self.__locked, self.__stopped = auth_started, False

    def _guard(self):
        require(not self.__stopped, 'EARLIER_FAILURE')
        self.__budget()
        epoch = self.__guard()
        require(type(epoch) is int and epoch in (1, 2, 3), 'OWNED_ROOT_REQUIRED')
        locked = self.__locked()
        require(type(locked) is bool, 'PRIVACY_LOCK_REQUIRED')
        if self.__mode == 'primary-prelogin':
            require(epoch == 1 and not locked, 'PRIMARY_PREAUTH_ONLY')
        return epoch

    def _observe(self):
        epoch = self._guard()
        value = validate_projection(self.__js(PUBLIC_DOM))
        require(self._guard() == epoch, 'ROOT_CHANGED_DURING_OBSERVATION')
        identity_ready = value['entryVisible'] and not value['nameVisible'] if self.__mode == 'primary-prelogin' else value['nameVisible'] and not value['entryVisible']
        ready = (not value['startupLoadingVisible'] and not value['onboardingVisible'] and
                 not value['loginVisible'] and not value['waiting'] and value['workspaceHeaderVisible'] and identity_ready)
        return {'schema': SCHEMA, 'mode': self.__mode, 'epoch': epoch, 'ready': ready,
                'step': value['step'], **{key: value[key] for key in FLAGS}, 'controls': value['controls']}

    def _take(self, step, epoch, point):
        require(point is not None and point['visible'] and point['hit'] and not point['disabled'], 'CONTROL_NOT_READY')
        require(self._guard() == epoch, 'ROOT_CHANGED_BEFORE_INPUT')
        # 与主编排共用持久一次性 journal；这些前置步骤从不设置认证锁。
        require(self.__claim('first_run_' + step, starts_auth=False) is True, 'ACTION_ALREADY_USED')
        require(self._guard() == epoch, 'ROOT_CHANGED_BEFORE_INPUT')
        for kind, extra in [('mouseMoved', {}), ('mousePressed', {'button': 'left', 'clickCount': 1}), ('mouseReleased', {'button': 'left', 'clickCount': 1})]:
            require(self._guard() == epoch, 'ROOT_CHANGED_DURING_INPUT')
            self.__cdp('Input.dispatchMouseEvent', type=kind, x=point['x'], y=point['y'], **extra)

    def phase(self, step):
        stage = 'validate'
        try:
            allowed = PRIMARY_STEPS if self.__mode == 'primary-prelogin' else ONBOARDING_STEPS
            require(step in (*allowed, 'observe'), 'PHASE_NOT_ALLOWED')
            stage = 'observe'
            value = self._observe()
            if step == 'observe':
                return {'phase': step, **value}
            stage = 'validate'
            if step == 'skip_login':
                require(value['loginVisible'] and not value['waiting'] and not value['nameVisible'], 'UNSTARTED_LOGIN_REQUIRED')
                target = 'skip_login'
            elif step == 'reopen_login':
                require(value['ready'], 'HEADER_AND_ENTRY_REQUIRED')
                target = 'reopen_login'
            else:
                require(not value['startupLoadingVisible'] and not value['loginVisible'] and not value['waiting'] and value['onboardingVisible'] and not value['errorVisible'], 'ONBOARDING_REQUIRED')
                expected = {'select_developer': 'role', 'next_role': 'role', 'select_coding': 'mode', 'next_mode': 'mode', 'finish': 'preferences'}[step]
                require(value['step'] == expected, 'WRONG_ONBOARDING_STEP')
                if step == 'next_role':
                    require(value['developerSelected'], 'DEVELOPER_REQUIRED')
                if step == 'next_mode':
                    require(value['codingSelected'], 'CODING_REQUIRED')
                if step == 'finish':
                    require(value['preferencesSafe'] and value['memoryUnchecked'] and value['migrationUnchecked'], 'DEFAULT_FALSE_PREFERENCES_REQUIRED')
                target = {'select_developer': 'developer', 'select_coding': 'coding'}.get(step, step)
            stage = 'input'
            self._take(step, value['epoch'], value['controls'][target])
            stage = 'result'
            return {'phase': step, 'inputDispatched': True, **self._observe()}
        except Exception as cause:
            self.__stopped = True
            # 原实现连本模块固定准入码也吞掉，导致真实设施失败被笼统归类；仅保留枚举，不交付异常原文。
            code = str(cause).removeprefix('FIRST_RUN_') if type(cause) is FirstRunUiError else ''
            failure = FirstRunUiError('FIRST_RUN_PHASE_FAILED_RAW_DETAILS_WITHHELD')
            failure.diagnostic = dict(
                phase=step if step in (*PRIMARY_STEPS, 'observe') else 'unknown',
                mode=self.__mode, stage=stage,
                causeCode=code if code in DIAGNOSTIC_CAUSES else 'UNCLASSIFIED',
                causeType=type(cause).__name__ if type(cause) in (FirstRunUiError, TimeoutError, ConnectionError, OSError, RuntimeError, ValueError, AssertionError) else 'Exception',
            )
            raise failure from None
