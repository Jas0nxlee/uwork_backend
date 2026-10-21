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
if stage in ('security-low','security-high'):
    high=stage=='security-high'
    if not high:
        new_tab(origin+'/#security');wait("!!document.querySelector('input[name=email]')",'login')
        fill('input[name=email]',control['email']);fill('input[name=password]',control['password']);click('button','登录')
        wait("document.querySelector('h1')?.textContent==='客户端安全'",'original security view')
    click('button','新建');wait("document.querySelectorAll('dialog[open] textarea').length===2",'security original form')
    name='Owned security high' if high else 'Owned security low'
    fill('dialog[open] .form-grid > label:nth-child(1) input',name)
    fill('dialog[open] .form-grid > label:nth-child(2) textarea',json.dumps(dict(all=True)),replace=True)
    fill('dialog[open] .form-grid > label:nth-child(3) input','10' if high else '1',replace=True)
    fill('dialog[open] .form-grid > label:nth-child(4) textarea',json.dumps(control['securityHigh' if high else 'securityLow']),replace=True)
    click('button','保存');wait("!document.querySelector('dialog[open]')&&document.querySelector('tbody')?.innerText.includes("+json.dumps(name)+")",'actual security row created')
    facts['created']=name
elif stage in ('security-high-disable','security-high-enable'):
    label='停用' if stage.endswith('disable') else '启用';rowclick('Owned security high',label)
    expected='0' if stage.endswith('disable') else '1'
    wait("[...document.querySelectorAll('tbody tr')].find(e=>e.querySelector('td')?.textContent.trim()==='Owned security high')?.querySelector('td:nth-child(4)')?.textContent.trim()==="+json.dumps(expected),'original high policy toggled')
    facts['enabled']=expected
elif stage in ('security-delete-high-cancel','security-delete-high','security-delete-low'):
    high=stage!='security-delete-low';name='Owned security high' if high else 'Owned security low'
    rowclick(name,'停用或删除');wait("!!document.querySelector('dialog[open]')",'original security delete confirmation')
    cancel=stage.endswith('cancel');click('button','取消' if cancel else '确认');wait("!document.querySelector('dialog[open]')",'delete finished')
    if cancel:assert js("document.querySelector('tbody').innerText.includes("+json.dumps(name)+")")
    else:
        wait("!document.querySelector('tbody')?.innerText.includes("+json.dumps(name)+")",'row deleted')
        cdp('Page.reload');wait("document.querySelector('h1')?.textContent==='客户端安全'&&!!document.querySelector('tbody')&&!document.querySelector('tbody').innerText.includes("+json.dumps(name)+")",'original security deletion persists')
    facts['cancelled']=cancel
else:raise AssertionError('unsupported original security stage')
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
