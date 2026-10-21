"""CDP event observation while original menus/tabs load their real HTTP data."""
import base64
import json
import os
from pathlib import Path
import time
from urllib.parse import urlparse

control=json.loads(Path(os.environ['UWORK_ADMIN_RUN_CONTROL']).read_text())
origin=control['origin'];stage=os.environ['UWORK_EXPERIENCE_STAGE'];width=int(stage.removeprefix('console-width-'))
assert stage=='console-width-'+str(width) and width in (320,768,1440)
assert urlparse(origin).hostname=='127.0.0.1' and urlparse(origin).port!=3000
errors=[];responses=[];expected_auth=[]


def collect():
    for e in drain_events():
        m=e['method'];p=e.get('params',{})
        if m=='Runtime.exceptionThrown':
            d=p.get('exceptionDetails',{});text=d.get('exception',{}).get('description') or d.get('text','exception')
            errors.append(dict(kind='uncaught',text=text.splitlines()[0][:400]))
        elif m=='Runtime.consoleAPICalled' and p.get('type') in ('error','assert','warning'):
            text=' '.join(str(a.get('value',a.get('description',''))) for a in p.get('args',[]))
            errors.append(dict(kind='console-'+p['type'],text=text[:400]))
        elif m=='Log.entryAdded' and p.get('entry',{}).get('level') in ('error','warning'):
            d=p['entry'];path=urlparse(d.get('url','')).path
            if d.get('source')=='network' and path=='/api/auth/me' and '401' in d.get('text',''):
                expected_auth.append(dict(kind='browser-anonymous-probe',status=401))
            else:errors.append(dict(kind='browser-'+d['level'],text=d.get('text','')[:400],path=path))
        elif m=='Network.responseReceived':
            r=p['response'];u=urlparse(r.get('url',''))
            if u.scheme in ('http','https'):
                assert u.scheme+'://'+u.netloc==origin,'frontend network must remain inside owned origin'
                if u.path.startswith('/api/'):
                    entry=dict(path=u.path,status=int(r['status']));responses.append(entry)
                    if entry['status']>=400:
                        if u.path=='/api/auth/me' and entry['status']==401:expected_auth.append(dict(kind='anonymous-probe',status=401))
                        else:errors.append(dict(kind='http',**entry))


def wait(expression,label):
    end=time.monotonic()+20
    while time.monotonic()<end:
        collect()
        if js(expression):return
        time.sleep(.05)
    geometry=js("(()=>{const a=document.querySelector('aside'),b=document.querySelector('button[aria-label=导航]');return{width:innerWidth,heading:document.querySelector('h1')?.textContent,asideClass:a?.className,asideRect:a?{x:a.getBoundingClientRect().x,right:a.getBoundingClientRect().right}:null,menuRect:b?{x:b.getBoundingClientRect().x,y:b.getBoundingClientRect().y}:null,scrollX,scrollY}})()")
    Path(control['consoleEvidence'],'failure-'+str(width)+'.png').write_bytes(base64.b64decode(cdp('Page.captureScreenshot',format='png')['data']))
    print('CONSOLE_OBSERVER_DIAGNOSTIC='+json.dumps(dict(label=label,errors=errors,responses=responses[-8:],geometry=geometry)))
    raise AssertionError('original console UI: '+label)


def click(role,label):
    a=[n for n in cdp('Accessibility.getFullAXTree')['nodes'] if not n.get('ignored') and n.get('role',{}).get('value')==role and n.get('name',{}).get('value')==label]
    assert len(a)==1,'unique original console-run control required'
    node=a[0]['backendDOMNodeId'];cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=node)
    q=cdp('DOM.getBoxModel',backendNodeId=node)['model']['content'];x,y=sum(q[0::2])/4,sum(q[1::2])/4
    tag='a' if role=='link' else 'button'
    assert js("(()=>{const e=document.elementFromPoint("+str(x)+","+str(y)+")?.closest("+json.dumps(tag)+");return !!e&&(e.getAttribute('aria-label')||e.textContent.trim())==="+json.dumps(label)+"})()"),'original control must not be occluded'
    click_at_xy(x,y)


def fill(selector,value):
    r=cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result'];assert r.get('objectId')
    try:
        cdp('DOM.getDocument',depth=0);node=cdp('DOM.requestNode',objectId=r['objectId'])['nodeId'];cdp('DOM.focus',nodeId=node);cdp('Input.insertText',text=value)
    finally:cdp('Runtime.releaseObject',objectId=r['objectId'])


new_tab('about:blank');cdp('Runtime.enable');cdp('Log.enable');drain_events()
marker='UWORK_OWNED_OBSERVER_CALIBRATION'
cdp('Runtime.evaluate',expression='console.error('+json.dumps(marker)+')')
deadline=time.monotonic()+5;calibrated=False
while time.monotonic()<deadline and not calibrated:
    for e in drain_events():
        if e['method']=='Runtime.consoleAPICalled' and e['params'].get('type')=='error':
            calibrated=any(a.get('value')==marker for a in e['params'].get('args',[])) or calibrated
    if not calibrated:time.sleep(.05)
assert calibrated,'actual CDP console event pipeline must be observed'
drain_events();cdp('Emulation.setDeviceMetricsOverride',width=width,height=950,deviceScaleFactor=1,mobile=False)
new_tab(origin+'/#overview')
# 此观测器显式新建background tab；v37已证明class=open但动画几何停在-230。
# 只激活自有headless标签，使原CSS动画正常交付，不修改应用样式/状态。
activate_tab(current_tab())
wait("!!document.querySelector('input[name=email]')||!!document.querySelector('.profile')",'original auth view')
if js("!!document.querySelector('input[name=email]')"):
    fill('input[name=email]',control['email']);fill('input[name=password]',control['password']);click('button','登录')
wait("document.querySelector('.profile small')?.textContent==='owner'",'owner original session')
views=[];tabs=[];prefix='/api/tenants/'+control['tenantId']
for index,v in enumerate(control['consoleViews']):
    before=len(responses)
    if index:
        if width==320:
            click('button','导航');wait("document.querySelector('aside.open')?.getBoundingClientRect().x>=0",'narrow original menu')
        click('link',v['label'])
    wait("document.querySelector('h1')?.textContent==="+json.dumps(v['label'])+"&&!document.querySelector('aside.open')",'original heading '+v['id'])
    if width==320:
        wait("document.querySelector('aside').getBoundingClientRect().right<=1",'narrow original menu closed')
    end=time.monotonic()+15
    while time.monotonic()<end:
        collect();recent=responses[before:] if index else responses
        if all(any(r['path']==prefix+path and 200<=r['status']<300 for r in recent) for path in v['endpoints']):break
        time.sleep(.05)
    assert all(any(r['path']==prefix+path and 200<=r['status']<300 for r in recent) for path in v['endpoints']),'real data responses required for '+v['id']
    wait("!document.querySelector('main [role=alert]')&&(!document.querySelector('.table-scroll')||document.querySelector('.table-scroll').getAttribute('aria-busy')==='false')",'real page ready '+v['id'])
    views.append(dict(id=v['id'],httpDataLoaded=True))
    if v['id']=='configuration':
        for i,t in enumerate(control['consoleTabs']):
            offset=len(responses)
            if i:click('button',t['label'])
            wait("Array.from(document.querySelectorAll('.tabs button')).some(e=>e.textContent==="+json.dumps(t['label'])+"&&e.getAttribute('aria-pressed')==='true')&&document.querySelector('section[aria-label=当前配置]')?.innerText.includes('发布版本')",'original config tab '+t['id'])
            collect();r=responses[offset:] if i else responses
            assert any(a['path']==prefix+'/configurations/'+t['id'] and a['status']==200 for a in r)
            tabs.append(dict(id=t['id'],httpDataLoaded=True))
    collect()
collect()
facts=dict(stage=stage,width=width,calibrationObserved=calibrated,views=views,configurationTabs=tabs,errors=errors,expectedAnonymousProbes=expected_auth,networkResponses=len(responses))
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
assert errors==[],'original browser errors are not allowed'
