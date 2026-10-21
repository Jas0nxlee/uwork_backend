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

facts=dict(stage=stage);name='Owned UI versioned agent'
if stage=='agent-create':
    new_tab(origin+'/#agents');wait("!!document.querySelector('input[name=email]')",'login')
    fill('input[name=email]',control['email']);fill('input[name=password]',control['password']);click('button','登录')
    wait("document.querySelector('h1')?.textContent==='企业智能体'",'original agents view')
    click('button','新建');wait("document.querySelectorAll('dialog[open] textarea').length===3",'original agent form')
    fill('dialog[open] .form-grid > label:nth-child(1) input',name)
    fill('dialog[open] .form-grid > label:nth-child(2) input',control['modelId'])
    fill('dialog[open] .form-grid > label:nth-child(3) textarea','OWNED_AGENT_SYSTEM_V1')
    fill('dialog[open] .form-grid > label:nth-child(9) input','64',replace=True)
    fill('dialog[open] .form-grid > label:nth-child(10) textarea',json.dumps(dict(all=True)),replace=True)
    click('button','保存');wait("!document.querySelector('dialog[open]')&&document.querySelector('tbody')?.innerText.includes("+json.dumps(name)+")",'agent created')
elif stage in ('agent-publish-v1','agent-publish-v2'):
    rowclick(name,'发布');wait("document.querySelectorAll('dialog[open] input').length===1",'version form')
    fill('dialog[open] input','1' if stage.endswith('v1') else '2',replace=True);click('button','保存');wait("!document.querySelector('dialog[open]')",'published')
elif stage=='agent-edit-v2':
    rowclick(name,'编辑');wait("document.querySelectorAll('dialog[open] textarea').length===3",'original agent editor')
    assert js("document.querySelector('dialog[open] .form-grid > label:nth-child(3) textarea').value")=='OWNED_AGENT_SYSTEM_V1'
    fill('dialog[open] .form-grid > label:nth-child(3) textarea','OWNED_AGENT_SYSTEM_V2',replace=True)
    click('button','保存');wait("!document.querySelector('dialog[open]')",'version2 saved')
elif stage=='agent-disable':
    rowclick(name,'停用或删除');wait("!!document.querySelector('dialog[open]')",'disable confirmation');click('button','确认');wait("!document.querySelector('dialog[open]')",'disabled')
    cdp('Page.reload');wait("document.querySelector('h1')?.textContent==='企业智能体'&&[...document.querySelectorAll('tbody tr')].find(e=>e.querySelector('td')?.textContent.trim()==="+json.dumps(name)+")?.querySelector('td:nth-child(5)')?.innerText.trim()==='否'",'disabled state persists')
else:
    assert stage in ('agent-run-unpublished','agent-run-v1','agent-run-old-v1','agent-run-v2','agent-run-disabled')
    rowclick(name,'执行');wait("document.querySelectorAll('dialog[open] textarea').length===1",'original row run form')
    fill('dialog[open] textarea','OWNED_'+stage.upper().replace('-','_'));click('button','保存')
    if stage in ('agent-run-unpublished','agent-run-disabled'):
        wait("document.querySelector('dialog[open] [role=alert]')?.textContent.includes('智能体未发布或未授权')",'actual agent denial')
        click('button','取消');wait("!document.querySelector('dialog[open]')",'cancel rejected execution')
    else:wait("!document.querySelector('dialog[open]')",'accepted execution')
facts['originalAgentAction']=stage
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
