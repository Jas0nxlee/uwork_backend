"""Original backend automation form, toggle and deletion; browser-harness input only."""
import json
import os
from pathlib import Path
import time
from urllib.parse import urlparse

control = json.loads(Path(os.environ['UWORK_ADMIN_RUN_CONTROL']).read_text())
stage = os.environ['UWORK_EXPERIENCE_STAGE']
origin = control['origin']
assert urlparse(origin).hostname=='127.0.0.1' and urlparse(origin).port!=3000


def wait(expression, label):
    end=time.monotonic()+20
    while time.monotonic()<end:
        if js(expression):return
        time.sleep(.1)
    raise AssertionError('automation UI condition: '+label)


def click(role, name):
    nodes=[n for n in cdp('Accessibility.getFullAXTree')['nodes'] if not n.get('ignored') and n.get('role',{}).get('value')==role and n.get('name',{}).get('value')==name]
    assert len(nodes)==1, 'unique original control required'
    node=nodes[0]['backendDOMNodeId']
    cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=node)
    q=cdp('DOM.getBoxModel',backendNodeId=node)['model']['content']
    click_at_xy(sum(q[0::2])/4,sum(q[1::2])/4)


def fill(selector, value, replace=False):
    result=cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result']
    assert result.get('objectId')
    try:
        cdp('DOM.getDocument',depth=0)
        node=cdp('DOM.requestNode',objectId=result['objectId'])['nodeId']
        cdp('DOM.focus',nodeId=node)
        if replace:
            cdp('Input.dispatchKeyEvent',type='keyDown',key='a',code='KeyA',modifiers=4,windowsVirtualKeyCode=65,commands=['selectAll'])
            cdp('Input.dispatchKeyEvent',type='keyUp',key='a',code='KeyA',modifiers=4,windowsVirtualKeyCode=65)
        cdp('Input.insertText',text=value)
        assert js('document.querySelector('+json.dumps(selector)+').value')==value
    finally:
        cdp('Runtime.releaseObject',objectId=result['objectId'])


def row(name):
    return "[...document.querySelectorAll('tbody tr')].find(e=>e.querySelector('td')?.textContent.trim()==="+json.dumps(name)+")"


def row_action(name, action):
    expression=row(name)
    wait('!!('+expression+')', 'owned row')
    p=js("(()=>{const e=("+expression+").querySelector('button[aria-label="+json.dumps(action)+"]');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()")
    click_at_xy(p['x'],p['y'])


def create(name, marker, due):
    click('button','新建')
    wait("document.querySelectorAll('dialog[open] textarea').length===2", 'original automation form')
    fill('dialog[open] .form-grid > label:nth-child(1) input',name)
    fill('dialog[open] .form-grid > label:nth-child(2) input',control['agentId'])
    fill('dialog[open] .form-grid > label:nth-child(3) textarea',marker)
    fill('dialog[open] .form-grid > label:nth-child(4) textarea',json.dumps(dict(type='once',at=due)),replace=True)
    click('button','保存')
    wait("!document.querySelector('dialog[open]')&&!!("+row(name)+")", 'created original automation')


paused='Owned paused once'
positive='Owned scheduled once'
facts=dict(stage=stage)
if stage=='create-paused':
    new_tab(origin+'/#automations')
    wait("!!document.querySelector('input[name=email]')", 'login prerequisite')
    fill('input[name=email]',control['email'])
    fill('input[name=password]',control['password'])
    click('button','登录')
    wait("document.querySelector('h1')?.textContent==='自动化'", 'backend automation view')
    create(paused,'OWNED_AUTOMATION_PAUSED',control['pausedDue'])
    row_action(paused,'停用')
    wait('!!('+row(paused)+').querySelector(\'button[aria-label=启用]\')', 'original disabled plan')
    facts['createdAndDisabledViaUi']=True
elif stage=='enable-expired':
    row_action(paused,'启用')
    wait("document.querySelector('[role=alert]')?.textContent.includes('计划已到期')", 'expired plan error')
    assert js('!!('+row(paused)+').querySelector(\'button[aria-label=启用]\')')
    facts['expiredEnableRejectedVisibly']=True
elif stage=='create-positive':
    create(positive,'OWNED_AUTOMATION_ONCE',control['positiveDue'])
    facts['createdFutureOnceViaUi']=True
elif stage=='scheduled-result':
    click('button','刷新')
    wait('!!('+row(positive)+').querySelector(\'button[aria-label=启用]\')', 'once automatically disabled')
    row_action(positive,'详情')
    wait("!!document.querySelector('pre.detail')", 'automation detail')
    value=js("(()=>{const d=JSON.parse(document.querySelector('pre.detail').textContent);return{disabled:d.enabled===0,nextEmpty:d.next_at===null,inputNotExposed:!('input'in d),once:d.schedule.type==='once'}})()")
    assert all(value.values())
    facts.update(value)
    click('button','关闭')
    click('link','执行任务')
    wait("document.querySelector('tbody')?.innerText.includes("+json.dumps(control['runId'])+")&&document.querySelector('tbody')?.innerText.includes('succeeded')", 'actual scheduled run row')
    click('button','详情')
    wait("!!document.querySelector('pre.detail')", 'scheduled run detail')
    assert js("(()=>{const d=JSON.parse(document.querySelector('pre.detail').textContent);return d.input==='OWNED_AUTOMATION_ONCE'&&d.output==='OWNED_ADMIN_RESULT'&&d.status==='succeeded'})()")
    click('button','关闭')
    click('link','自动化')
    wait("document.querySelector('h1')?.textContent==='自动化'&&!!("+row(positive)+")", 'automation view restored')
    facts['scheduledRunDetailMatches']=True
elif stage in ('delete-cancel','delete-confirm'):
    row_action(paused,'停用或删除')
    wait("!!document.querySelector('dialog[open]')", 'original delete confirmation')
    click('button','取消' if stage=='delete-cancel' else '确认')
    wait("!document.querySelector('dialog[open]')", 'dialog closed')
    if stage=='delete-cancel':
        assert js('!!('+row(paused)+')')
        facts['cancelPreservesPlan']=True
    else:
        wait('!('+row(paused)+')&&!!('+row(positive)+')', 'only selected plan deleted')
        cdp('Page.reload')
        wait("document.querySelector('h1')?.textContent==='自动化'&&! ("+row(paused)+")&&!!("+row(positive)+")", 'deletion survives reload')
        facts['deleteAndReloadPreserveOtherPlan']=True
else:
    raise AssertionError('unsupported automation stage')
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
