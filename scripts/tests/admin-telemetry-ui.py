"""Original observability pages and manual retention; owned private runtime only."""
import json
import os
from pathlib import Path
import time
from urllib.parse import urlparse

control=json.loads(Path(os.environ['UWORK_ADMIN_RUN_CONTROL']).read_text())
stage=os.environ['UWORK_EXPERIENCE_STAGE'];origin=control['origin']
assert urlparse(origin).hostname=='127.0.0.1' and urlparse(origin).port!=3000


def wait(expression,label):
    end=time.monotonic()+20
    while time.monotonic()<end:
        if js(expression):return
        time.sleep(.1)
    print('TELEMETRY_UI_DIAGNOSTIC='+json.dumps(js("({heading:document.querySelector('h1')?.textContent,total:document.querySelector('.pagination>span')?.textContent,busy:document.querySelector('.table-scroll')?.getAttribute('aria-busy'),rowCount:document.querySelectorAll('tbody tr').length,alert:document.querySelector('[role=alert]')?.textContent,dimension:document.querySelector('select[aria-label=聚合维度]')?.value})")))
    raise AssertionError('original telemetry UI: '+label)


def click(role,label):
    a=[n for n in cdp('Accessibility.getFullAXTree')['nodes'] if not n.get('ignored') and n.get('role',{}).get('value')==role and n.get('name',{}).get('value')==label]
    assert len(a)==1,'unique original telemetry control required'
    node=a[0]['backendDOMNodeId'];cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=node)
    q=cdp('DOM.getBoxModel',backendNodeId=node)['model']['content'];click_at_xy(sum(q[0::2])/4,sum(q[1::2])/4)


def focus(selector):
    r=cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result'];assert r.get('objectId')
    try:
        cdp('DOM.getDocument',depth=0);node=cdp('DOM.requestNode',objectId=r['objectId'])['nodeId'];cdp('DOM.focus',nodeId=node)
    finally:cdp('Runtime.releaseObject',objectId=r['objectId'])


def fill(selector,value,replace=False):
    focus(selector)
    if replace:
        cdp('Input.dispatchKeyEvent',type='keyDown',key='a',code='KeyA',modifiers=4,windowsVirtualKeyCode=65,commands=['selectAll'])
        cdp('Input.dispatchKeyEvent',type='keyUp',key='a',code='KeyA',modifiers=4,windowsVirtualKeyCode=65)
    if value:cdp('Input.insertText',text=value)
    else:
        cdp('Input.dispatchKeyEvent',type='keyDown',key='Backspace',code='Backspace',windowsVirtualKeyCode=8)
        cdp('Input.dispatchKeyEvent',type='keyUp',key='Backspace',code='Backspace',windowsVirtualKeyCode=8)
    assert js('document.querySelector('+json.dumps(selector)+').value')==value


def view(label,count):
    click('link',label)
    wait("document.querySelector('h1')?.textContent==="+json.dumps(label)+"&&document.querySelector('.pagination>span')?.textContent==="+json.dumps('共 '+str(count)+' 条')+"&&document.querySelector('.table-scroll')?.getAttribute('aria-busy')==='false'",'loaded '+label)
    assert len(js("Array.from(document.querySelectorAll('tbody tr')).filter(r=>!r.querySelector('.empty')).map(r=>r.innerText)"))==count


def aggregate():
    view('用量聚合',1)
    expected={ 'member':control['userId'], 'department':'-', 'application':'uwork' }
    for i,(dimension,subject) in enumerate(expected.items()):
        if i:
            focus('select[aria-label=聚合维度]')
            for c in {'department':'部门','application':'应用'}[dimension]:
                cdp('Input.dispatchKeyEvent',type='char',text=c,unmodifiedText=c)
            cdp('Input.dispatchKeyEvent',type='rawKeyDown',key='Tab',code='Tab',windowsVirtualKeyCode=9,modifiers=0)
            cdp('Input.dispatchKeyEvent',type='keyUp',key='Tab',code='Tab',windowsVirtualKeyCode=9)
            assert js("document.querySelector('select[aria-label=聚合维度]').value")==dimension
        wait("document.querySelector('select[aria-label=聚合维度]').value==="+json.dumps(dimension)+"&&document.querySelector('tbody tr td')?.textContent==="+json.dumps(subject)+"&&document.querySelector('.table-scroll').getAttribute('aria-busy')==='false'",'real aggregation '+dimension)
        values=js("Array.from(document.querySelectorAll('tbody tr td')).slice(0,5).map(c=>c.textContent)")
        assert values==[subject,'28','24','4','2'], 'actual original aggregate values required'
    fill('input[aria-label=搜索]','owned-model-does-not-exist');click('button','查询')
    wait("document.querySelector('.pagination>span')?.textContent==='共 0 条'&&document.querySelector('.table-scroll').getAttribute('aria-busy')==='false'",'empty aggregate search')
    fill('input[aria-label=搜索]',str(control['modelId']),replace=True);click('button','查询')
    wait("document.querySelector('.pagination>span')?.textContent==='共 1 条'&&document.querySelector('tbody tr td')?.textContent==='uwork'&&document.querySelector('.table-scroll').getAttribute('aria-busy')==='false'",'model-filtered aggregate restored')


facts=dict(stage=stage)
if stage in ('inspect-before-purge','inspect-after-purge'):
    if stage=='inspect-before-purge':
        new_tab(origin+'/#usage');wait("!!document.querySelector('input[name=email]')",'login prerequisite')
        fill('input[name=email]',control['email']);fill('input[name=password]',control['password']);click('button','登录')
        wait("document.querySelector('h1')?.textContent==='用量明细'&&document.querySelector('.pagination>span')?.textContent==='共 2 条'",'actual ledger loaded')
    else:
        cdp('Page.reload');wait("document.querySelector('h1')?.textContent==='企业与企微'&&document.querySelector('.settings-value')?.textContent==='Owned run UI'",'enterprise reload after purge')
    view('用量明细',2)
    amounts=js("Array.from(document.querySelectorAll('tbody tr')).map(r=>Array.from(r.querySelectorAll('td')).slice(0,6).map(c=>c.textContent))")
    assert all(row==[control['userId'],'uwork','settled','14','12','2'] for row in amounts)
    n=2 if stage=='inspect-before-purge' else 1
    view('调用追踪',n);view('终端事件',n)
    assert js("Array.from(document.querySelectorAll('tbody tr')).every(r=>r.innerText.includes('configuration.applied'))")
    aggregate();facts.update(actualUsageCredits=28,originalTraceAndEventRows=n,threeAggregationDimensions=True,emptyAndModelSearch=True)
elif stage in ('purge-aged','purge-again'):
    click('link','企业与企微');wait("document.querySelector('h1')?.textContent==='企业与企微'&&document.body.innerText.includes('已配置：保留 7 天')",'configured cleanup owner')
    click('button','立即清理');wait("!!document.querySelector('pre.detail')",'actual cleanup receipt')
    receipt=js("JSON.parse(document.querySelector('pre.detail').textContent)")
    n=1 if stage=='purge-aged' else 0
    assert receipt==dict(audit=n,traces=n,client_events=n,gateway_calls=n,runs=0,sandbox_executions=0)
    facts['cleanupCounts']=receipt;click('button','关闭')
else:raise AssertionError('unsupported telemetry stage')
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
