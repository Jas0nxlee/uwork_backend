"""Original access/distribution model deny form and lifecycle controls."""
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
    raise AssertionError('original policy UI: '+label)


def click(role,name):
    a=[n for n in cdp('Accessibility.getFullAXTree')['nodes'] if not n.get('ignored') and n.get('role',{}).get('value')==role and n.get('name',{}).get('value')==name]
    assert len(a)==1,'unique original control required'
    node=a[0]['backendDOMNodeId'];cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=node)
    q=cdp('DOM.getBoxModel',backendNodeId=node)['model']['content'];click_at_xy(sum(q[0::2])/4,sum(q[1::2])/4)


def focus(selector):
    r=cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result']
    assert r.get('objectId')
    try:
        cdp('DOM.getDocument',depth=0);node=cdp('DOM.requestNode',objectId=r['objectId'])['nodeId'];cdp('DOM.focus',nodeId=node)
    finally:cdp('Runtime.releaseObject',objectId=r['objectId'])


def fill(selector,value,replace=False):
    focus(selector)
    if replace:
        cdp('Input.dispatchKeyEvent',type='keyDown',key='a',code='KeyA',modifiers=4,windowsVirtualKeyCode=65,commands=['selectAll'])
        cdp('Input.dispatchKeyEvent',type='keyUp',key='a',code='KeyA',modifiers=4,windowsVirtualKeyCode=65)
    cdp('Input.insertText',text=value)
    assert js('document.querySelector('+json.dumps(selector)+').value')==value


facts=dict(stage=stage)
if stage=='create-deny':
    new_tab(origin+'/#policies')
    wait("!!document.querySelector('input[name=email]')",'login prerequisite')
    fill('input[name=email]',control['email']);fill('input[name=password]',control['password']);click('button','登录')
    wait("document.querySelector('h1')?.textContent==='访问与分发'",'original policy view')
    click('button','新建');wait("document.querySelectorAll('dialog[open] textarea').length===2",'original policy form')
    fill('dialog[open] .form-grid > label:nth-child(1) input','Owned model deny')
    fill('dialog[open] .form-grid > label:nth-child(3) textarea',json.dumps(dict(all=True)),replace=True)
    selector='dialog[open] .form-grid > label:nth-child(4) select'
    focus(selector)
    for c in 'deny':cdp('Input.dispatchKeyEvent',type='char',text=c,unmodifiedText=c)
    cdp('Input.dispatchKeyEvent',type='rawKeyDown',key='Tab',code='Tab',windowsVirtualKeyCode=9,modifiers=0)
    cdp('Input.dispatchKeyEvent',type='keyUp',key='Tab',code='Tab',windowsVirtualKeyCode=9)
    assert js('document.querySelector('+json.dumps(selector)+').value')=='deny'
    fill('dialog[open] .form-grid > label:nth-child(5) textarea',json.dumps([control['modelId']]),replace=True)
    click('button','保存');wait("!document.querySelector('dialog[open]')&&document.querySelector('tbody')?.innerText.includes('Owned model deny')",'original deny created')
    facts['createdDenyWithRealResourceReference']=True
elif stage in ('disable-policy','enable-policy'):
    click('button','停用' if stage=='disable-policy' else '启用')
    expected='0' if stage=='disable-policy' else '1'
    wait("document.querySelector('tbody tr td:nth-child(5)')?.textContent.trim()==="+json.dumps(expected),'original policy toggle')
    facts['originalToggleApplied']=True
elif stage in ('delete-policy-cancel','delete-policy-confirm'):
    click('button','停用或删除');wait("!!document.querySelector('dialog[open]')",'original policy delete confirmation')
    click('button','取消' if stage=='delete-policy-cancel' else '确认')
    wait("!document.querySelector('dialog[open]')",'delete dialog completed')
    if stage=='delete-policy-cancel':
        assert js("document.querySelector('tbody').innerText.includes('Owned model deny')")
        facts['cancelPreservesPolicy']=True
    else:
        wait("document.querySelector('tbody')?.innerText.includes('暂无记录')",'policy deleted')
        cdp('Page.reload');wait("document.querySelector('h1')?.textContent==='访问与分发'&&document.querySelector('tbody')?.innerText.includes('暂无记录')",'policy deletion persisted')
        facts['deletePersistsAfterReload']=True
else:raise AssertionError('unsupported policy stage')
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
