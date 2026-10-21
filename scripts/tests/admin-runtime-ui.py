"""Owned original admin Runtime UI; physical input and read-only DOM only."""
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
    raise AssertionError('original Runtime UI: '+label)


def click(role,name):
    a=[n for n in cdp('Accessibility.getFullAXTree')['nodes'] if not n.get('ignored') and n.get('role',{}).get('value')==role and n.get('name',{}).get('value')==name]
    assert len(a)==1,'unique original owned control required'
    node=a[0]['backendDOMNodeId'];cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=node)
    q=cdp('DOM.getBoxModel',backendNodeId=node)['model']['content'];click_at_xy(sum(q[0::2])/4,sum(q[1::2])/4)


def fill(selector,value,replace=False):
    r=cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result']
    assert r.get('objectId')
    try:
        cdp('DOM.getDocument',depth=0);node=cdp('DOM.requestNode',objectId=r['objectId'])['nodeId'];cdp('DOM.focus',nodeId=node)
        if replace:
            cdp('Input.dispatchKeyEvent',type='keyDown',key='a',code='KeyA',modifiers=4,windowsVirtualKeyCode=65,commands=['selectAll'])
            cdp('Input.dispatchKeyEvent',type='keyUp',key='a',code='KeyA',modifiers=4,windowsVirtualKeyCode=65)
        cdp('Input.insertText',text=value)
        assert js('document.querySelector('+json.dumps(selector)+').value')==value
    finally:cdp('Runtime.releaseObject',objectId=r['objectId'])


def open_execution(code):
    click('button','执行代码')
    wait("!!document.querySelector('dialog[open] textarea')",'original JavaScript form')
    fill('dialog[open] textarea',code,replace=True)
    click('button','保存')
    wait("document.querySelectorAll('dialog[open]').length===1&&!!document.querySelector('pre.detail')",'accepted execution detail')
    result=js("JSON.parse(document.querySelector('pre.detail').textContent)")
    assert isinstance(result.get('id'),str)
    click('button','关闭')
    return result['id']


facts=dict(stage=stage)
if stage=='create-runtime':
    new_tab(origin+'/#runtimes')
    wait("!!document.querySelector('input[name=email]')",'login prerequisite')
    fill('input[name=email]',control['email']);fill('input[name=password]',control['password']);click('button','登录')
    wait("document.querySelector('h1')?.textContent==='隔离 Runtime'",'Runtime original view')
    click('button','新建')
    wait("document.querySelectorAll('dialog[open] input').length===2",'Runtime original create form')
    fill('dialog[open] .form-grid > label:nth-child(1) input','Owned Docker Runtime')
    fill('dialog[open] .form-grid > label:nth-child(2) input','2',replace=True)
    click('button','保存')
    wait("!document.querySelector('dialog[open]')&&document.querySelector('tbody')?.innerText.includes('ready')",'Runtime ready row')
    facts['createdViaOriginalForm']=True
elif stage=='edit-runtime':
    click('button','编辑')
    wait("!!document.querySelector('dialog[open] textarea')",'original Runtime scope editor')
    scope=js("JSON.parse(document.querySelector('dialog[open] textarea').value)")
    assert scope['all'] is False and scope['members']==[control['userId']]
    fill('dialog[open] input','Owned Docker Runtime revised',replace=True)
    click('button','保存')
    wait("!document.querySelector('dialog[open]')&&document.querySelector('tbody')?.innerText.includes('Owned Docker Runtime revised')",'Runtime metadata update')
    facts['updatedNameAndRetainedOwnerScope']=True
elif stage=='execute-short':
    facts['executionId']=open_execution(control['shortCode'])
elif stage=='short-output':
    click('link','代码执行')
    wait("document.querySelector('tbody')?.innerText.includes("+json.dumps(control['shortId'])+")&&document.querySelector('tbody')?.innerText.includes('succeeded')",'successful original execution row')
    click('button','详情')
    wait("!!document.querySelector('pre.detail')",'actual decrypted output')
    value=js("(()=>{const d=JSON.parse(document.querySelector('pre.detail').textContent);return{status:d.status,exit:d.exit_code,stdout:JSON.parse(d.stdout),stderr:d.stderr,runtimeMatches:d.runtime_id==="+json.dumps(control['runtimeId'])+"}})()")
    assert value==dict(status='succeeded',exit=0,stdout=dict(sum=55,uid=1000,cwd='/workspace',noKey=True),stderr='',runtimeMatches=True)
    facts['originalOutputMatchesRealCode']=True
    click('button','关闭')
    click('link','隔离 Runtime')
    wait("document.querySelector('h1')?.textContent==='隔离 Runtime'&&document.querySelector('tbody')?.innerText.includes('ready')",'Runtime ready for next execution')
elif stage=='execute-long':
    facts['executionId']=open_execution(control['longCode'])
elif stage=='stop-busy':
    click('button','刷新')
    wait("document.querySelector('tbody')?.innerText.includes('busy')",'actual busy Runtime')
    click('button','停止 Runtime')
    wait("document.querySelector('tbody')?.innerText.includes('stopped')&&!document.querySelector('button[aria-label=\"停止 Runtime\"]')",'original Runtime stopped')
    assert js("document.querySelector('button[aria-label=执行代码]').disabled")
    facts['stoppedAndExecutionDisabled']=True
elif stage=='cancelled-detail':
    click('link','代码执行')
    row="[...document.querySelectorAll('tbody tr')].find(e=>e.innerText.includes("+json.dumps(control['longId'])+"))"
    wait('('+row+")?.innerText.includes('cancelled')",'cancelled real execution')
    p=js("(()=>{const e=("+row+").querySelector('button[aria-label=详情]');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()")
    click_at_xy(p['x'],p['y']);wait("!!document.querySelector('pre.detail')",'cancelled execution detail')
    d=js("JSON.parse(document.querySelector('pre.detail').textContent)")
    assert d['status']=='cancelled' and d['error_code']=='CANCELLED' and d['runtime_id']==control['runtimeId']
    click('button','关闭');cdp('Page.reload')
    wait("document.querySelectorAll('tbody tr').length===2&&document.querySelector('tbody')?.innerText.includes('succeeded')&&document.querySelector('tbody')?.innerText.includes('cancelled')",'both terminal histories after reload')
    facts['cancelledDetailAndReloadPersisted']=True
elif stage=='delete-runtime':
    click('link','隔离 Runtime')
    wait("document.querySelector('h1')?.textContent==='隔离 Runtime'&&document.querySelector('tbody')?.innerText.includes('stopped')",'stopped Runtime original row')
    click('button','停用或删除');wait("!!document.querySelector('dialog[open]')",'original Runtime delete confirmation')
    click('button','确认');wait("!document.querySelector('dialog[open]')&&document.querySelector('tbody')?.innerText.includes('暂无记录')",'Runtime deleted')
    cdp('Page.reload');wait("document.querySelector('h1')?.textContent==='隔离 Runtime'&&document.querySelector('tbody')?.innerText.includes('暂无记录')",'deleted Runtime reload')
    facts['runtimeDeletionPersisted']=True
else:raise AssertionError('unsupported Runtime stage')
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
