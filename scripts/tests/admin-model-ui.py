"""Original model probe/editor/disable controls in one owned browser-harness session."""
import json
import os
from pathlib import Path
import time
from urllib.parse import urlparse

control=json.loads(Path(os.environ['UWORK_ADMIN_RUN_CONTROL']).read_text())
stage=os.environ['UWORK_EXPERIENCE_STAGE']
origin=control['origin']
assert urlparse(origin).hostname=='127.0.0.1' and urlparse(origin).port!=3000


def wait(expression,label):
    end=time.monotonic()+20
    while time.monotonic()<end:
        if js(expression):return
        time.sleep(.1)
    raise AssertionError('original model UI condition: '+label)


def click(role,name):
    a=[n for n in cdp('Accessibility.getFullAXTree')['nodes'] if not n.get('ignored') and n.get('role',{}).get('value')==role and n.get('name',{}).get('value')==name]
    assert len(a)==1,'unique original model control required'
    node=a[0]['backendDOMNodeId'];cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=node)
    q=cdp('DOM.getBoxModel',backendNodeId=node)['model']['content']
    click_at_xy(sum(q[0::2])/4,sum(q[1::2])/4)


def fill(selector,value,replace=False):
    r=cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result']
    assert r.get('objectId')
    try:
        cdp('DOM.getDocument',depth=0)
        node=cdp('DOM.requestNode',objectId=r['objectId'])['nodeId'];cdp('DOM.focus',nodeId=node)
        if replace:
            cdp('Input.dispatchKeyEvent',type='keyDown',key='a',code='KeyA',modifiers=4,windowsVirtualKeyCode=65,commands=['selectAll'])
            cdp('Input.dispatchKeyEvent',type='keyUp',key='a',code='KeyA',modifiers=4,windowsVirtualKeyCode=65)
        cdp('Input.insertText',text=value)
        assert js('document.querySelector('+json.dumps(selector)+').value')==value
    finally:cdp('Runtime.releaseObject',objectId=r['objectId'])


def field(index):return 'dialog[open] .form-grid > label:nth-child('+str(index)+') input'


facts=dict(stage=stage)
if stage=='probe-and-edit':
    new_tab(origin+'/#models')
    wait("!!document.querySelector('input[name=email]')",'login prerequisite')
    fill('input[name=email]',control['email']);fill('input[name=password]',control['password']);click('button','登录')
    wait("document.querySelector('h1')?.textContent==='模型管理'&&document.querySelector('tbody')?.innerText.includes('Owned model')",'original model row')
    click('button','测试连接')
    wait("!!document.querySelector('pre.detail')",'original probe detail')
    value=js("(()=>{const d=JSON.parse(document.querySelector('pre.detail').textContent);return{reachable:d.reachable===true,modelsEndpoint:d.modelsEndpoint===true,latencyValid:Number.isFinite(d.latencyMs)&&d.latencyMs>=0}})()")
    assert all(value.values());facts.update(value);click('button','关闭')
    click('button','编辑')
    wait("document.querySelectorAll('dialog[open] input').length===12",'original model editor')
    expected=['Owned model','owned',control['modelBaseUrl'],control['credentialId'],'128000','128','1000','1000']
    assert js("[...document.querySelectorAll('dialog[open] input')].slice(0,8).map(e=>e.value)")==expected
    facts['originalDataFieldsPrefilled']=True
    fill(field(1),'Owned model revised',replace=True)
    fill(field(6),'256',replace=True);fill(field(7),'2000',replace=True);fill(field(8),'3000',replace=True)
    click('button','保存')
    wait("!document.querySelector('dialog[open]')&&document.querySelector('tbody')?.innerText.includes('Owned model revised')",'original updated model row')
    facts['editedViaOriginalForm']=True
elif stage in ('disable-cancel','disable-confirm'):
    click('button','停用或删除')
    wait("!!document.querySelector('dialog[open]')",'original model disable dialog')
    click('button','取消' if stage=='disable-cancel' else '确认')
    wait("!document.querySelector('dialog[open]')",'disable dialog closed')
    if stage=='disable-confirm':
        wait("document.querySelector('tbody tr td:nth-child(4)')?.textContent.trim()==='否'",'model disabled row')
    facts['originalDisableDialogCompleted']=True
elif stage=='restore-edit':
    click('button','编辑')
    wait("!!document.querySelector('dialog[open] input[type=checkbox]')",'disabled model editor')
    assert js("document.querySelector('dialog[open] .form-grid > label:nth-child(6) input').value")== '256'
    assert not js("document.querySelector('dialog[open] .form-grid > label:nth-child(13) input').checked")
    click('checkbox','启用')
    click('button','保存')
    wait("!document.querySelector('dialog[open]')&&document.querySelector('tbody tr td:nth-child(4)')?.textContent.trim()==='是'",'original model enabled again')
    cdp('Page.reload')
    wait("document.querySelector('tbody tr td:nth-child(5)')?.textContent.trim()==='4'",'model revision persists after reload')
    facts['enabledAndRevisionPersisted']=True
else:raise AssertionError('unsupported original model stage')
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
