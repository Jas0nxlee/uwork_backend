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


def rowclick(name,label):
    target=js("(()=>{const rows=[...document.querySelectorAll('tbody tr')].filter(e=>e.querySelector('td')?.textContent.trim()==="+json.dumps(name)+");const a=rows.flatMap(r=>[...r.querySelectorAll('button')].filter(e=>(e.getAttribute('aria-label')||e.innerText).trim()==="+json.dumps(label)+"));const e=a.length===1?a[0]:null,r=e?.getBoundingClientRect();return{ok:!!r&&!e.disabled&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),x:r?.x+r?.width/2,y:r?.y+r?.height/2}})()")
    assert target['ok'],'unique active original policy row action';click_at_xy(target['x'],target['y'])

facts=dict(stage=stage)
if stage=='binding-configure':
    new_tab(origin+'/#enterprise');wait("!!document.querySelector('input[name=email]')",'login')
    fill('input[name=email]',control['email']);fill('input[name=password]',control['password']);click('button','登录')
    wait("document.querySelector('h1')?.textContent==='企业与企微'",'enterprise view')
if stage in ('binding-configure','binding-corp-change-rejected'):
    click('button','配置应用');wait("document.querySelectorAll('dialog[open] input').length===3",'original application form')
    for index,value in enumerate(['OWNED_BINDING_CORP' if stage=='binding-configure' else 'OWNED_BINDING_OTHER_CORP','1000001',control['credentialId']],1):fill('dialog[open] .form-grid > label:nth-child('+str(index)+') input',value)
    click('button','保存')
    if stage=='binding-corp-change-rejected':
        wait("document.querySelector('dialog[open] [role=alert]')?.textContent.includes('已绑定企业不能直接更换 CorpId')",'actual immutable corp error');click('button','取消')
    wait("!document.querySelector('dialog[open]')",'application dialog finished')
elif stage in ('binding-settings-a','binding-settings-a-repeat'):
    click('button','绑定身份');wait("document.querySelectorAll('dialog[open] input').length===2",'settings identity form')
    fill('dialog[open] .form-grid > label:nth-child(1) input',control['bindingMemberA']);fill('dialog[open] .form-grid > label:nth-child(2) input','OWNED_BINDING_A');click('button','保存');wait("!document.querySelector('dialog[open]')",'identity bound')
else:
    assert stage in ('binding-row-b-conflict','binding-row-b-success','binding-row-a-prefill-reload')
    if stage=='binding-row-b-conflict':
        click('link','成员与席位');wait("document.querySelector('h1')?.textContent==='成员与席位'&&document.querySelectorAll('tbody tr').length===3",'members view')
    if stage=='binding-row-a-prefill-reload':
        cdp('Page.reload');wait("document.querySelector('h1')?.textContent==='成员与席位'&&[...document.querySelectorAll('tbody tr')].filter(e=>e.innerText.includes('OWNED_BINDING_')).length===2",'bindings persist')
        rowclick('Owned binding A','绑定 Owned binding A 的企微身份');wait("document.querySelector('dialog[open] input')?.value==='OWNED_BINDING_A'",'A original form prefills existing binding');click('button','取消');wait("!document.querySelector('dialog[open]')",'cancel prefilled editor')
    else:
        rowclick('Owned binding B','绑定 Owned binding B 的企微身份');wait("document.querySelectorAll('dialog[open] input').length===1",'member identity form')
        fill('dialog[open] input','OWNED_BINDING_A' if stage.endswith('conflict') else 'OWNED_BINDING_B');click('button','保存')
        if stage.endswith('conflict'):
            wait("document.querySelector('dialog[open] [role=alert]')?.textContent.includes('企微身份已绑定')",'actual bound identity rejection');click('button','取消')
        wait("!document.querySelector('dialog[open]')",'member form closed')
facts['originalBindingAction']=stage
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
