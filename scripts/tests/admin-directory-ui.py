"""Original directory forms and member seat/status changes in owned browser-harness."""
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
    raise AssertionError('original directory UI: '+label)


def click(role,name):
    a=[n for n in cdp('Accessibility.getFullAXTree')['nodes'] if not n.get('ignored') and n.get('role',{}).get('value')==role and n.get('name',{}).get('value')==name]
    assert len(a)==1,'unique original control required'
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
        if not value:
            for kind in ['keyDown','keyUp']:cdp('Input.dispatchKeyEvent',type=kind,key='Backspace',code='Backspace',windowsVirtualKeyCode=8)
    if value:cdp('Input.insertText',text=value)
    assert js('document.querySelector('+json.dumps(selector)+').value')==value


def select(selector,value):
    focus(selector)
    for c in value:cdp('Input.dispatchKeyEvent',type='char',text=c,unmodifiedText=c)
    cdp('Input.dispatchKeyEvent',type='rawKeyDown',key='Tab',code='Tab',windowsVirtualKeyCode=9,modifiers=0)
    cdp('Input.dispatchKeyEvent',type='keyUp',key='Tab',code='Tab',windowsVirtualKeyCode=9)
    assert js('document.querySelector('+json.dumps(selector)+').value')==value


def navigate(name):
    click('link',name);wait("document.querySelector('h1')?.textContent==="+json.dumps(name),'new directory view')


def row_action(name,action):
    p=js("(()=>{const a=[...document.querySelectorAll('tbody tr')].filter(e=>e.querySelector('td')?.textContent.trim()==="+json.dumps(name)+");if(a.length!==1)return{ok:false};const e=a[0].querySelector('button[aria-label="+json.dumps(action)+"]');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{ok:true,x:r.x+r.width/2,y:r.y+r.height/2}})()")
    assert p['ok'];click_at_xy(p['x'],p['y'])


def open_member():
    navigate('成员与席位')
    wait("document.querySelector('tbody')?.innerText.includes('Owned UI member')",'owned member row')
    row_action('Owned UI member','编辑')
    wait("document.querySelectorAll('dialog[open] select').length===2",'original membership editor')


def save():
    click('button','保存');wait("!document.querySelector('dialog[open]')",'original form completed')


facts=dict(stage=stage)
if stage=='create-department':
    new_tab(origin+'/#departments');wait("!!document.querySelector('input[name=email]')",'login prerequisite')
    fill('input[name=email]',control['email']);fill('input[name=password]',control['password']);click('button','登录')
    wait("document.querySelector('h1')?.textContent==='部门'",'original departments view')
    click('button','新建');wait("document.querySelectorAll('dialog[open] input').length===2",'original department create')
    fill('dialog[open] .form-grid > label:nth-child(1) input','Owned UI department');save()
    wait("document.querySelector('tbody')?.innerText.includes('Owned UI department')",'created department row')
    facts['departmentCreatedViaOriginalForm']=True
elif stage=='create-member':
    navigate('成员与席位');click('button','新建');wait("!!document.querySelector('dialog[open] input[type=password]')",'original member create')
    fill('dialog[open] .form-grid > label:nth-child(1) input','Owned UI member')
    fill('dialog[open] .form-grid > label:nth-child(2) input','owned-ui-member@example.test')
    fill('dialog[open] .form-grid > label:nth-child(3) input',control['password'])
    fill('dialog[open] .form-grid > label:nth-child(5) input',control['departmentId'])
    assert not js("document.querySelector('dialog[open] input[type=checkbox]').checked")
    save();wait("document.querySelector('tbody')?.innerText.includes('Owned UI member')",'created member row')
    facts['memberCreatedWithoutSeat']=True
elif stage in ('allocate-seat','revoke-seat','disable-member','reactivate-member','clear-member-department'):
    open_member()
    if stage in ('allocate-seat','revoke-seat'):
        expected=stage=='allocate-seat';assert js("document.querySelector('dialog[open] input[type=checkbox]').checked") is (not expected)
        click('checkbox','席位')
    elif stage in ('disable-member','reactivate-member'):
        select('dialog[open] .form-grid > label:nth-child(3) select','disabled' if stage=='disable-member' else 'active')
        if stage=='reactivate-member':
            assert not js("document.querySelector('dialog[open] input[type=checkbox]').checked")
            click('checkbox','席位')
    else:fill('dialog[open] .form-grid > label:nth-child(2) input','',replace=True)
    save();facts['originalMembershipChangeApplied']=True
elif stage=='rename-department':
    navigate('部门');wait("document.querySelector('tbody')?.innerText.includes('Owned UI department')",'original department row')
    row_action('Owned UI department','编辑');wait("!!document.querySelector('dialog[open] input')",'department original editor')
    fill('dialog[open] .form-grid > label:nth-child(1) input','Owned UI department revised',replace=True);save()
    wait("document.querySelector('tbody')?.innerText.includes('Owned UI department revised')",'department renamed')
    facts['departmentRenamedWithSameId']=True
elif stage in ('delete-in-use-department','delete-empty-department'):
    navigate('部门');wait("document.querySelector('tbody')?.innerText.includes('Owned UI department revised')",'department original delete target')
    row_action('Owned UI department revised','停用或删除');wait("!!document.querySelector('dialog[open]')",'department confirmation')
    click('button','确认')
    if stage=='delete-in-use-department':
        wait("document.querySelector('dialog[open] [role=alert]')?.textContent.includes('部门仍有成员或子部门')",'real in-use department refusal')
        click('button','取消');facts['inUseDepartmentRejectedVisibly']=True
    else:
        wait("!document.querySelector('dialog[open]')&&document.querySelector('tbody')?.innerText.includes('暂无记录')",'empty department deleted')
        cdp('Page.reload');wait("document.querySelector('h1')?.textContent==='部门'&&document.querySelector('tbody')?.innerText.includes('暂无记录')",'department deleted after reload')
        facts['emptyDepartmentDeletionPersisted']=True
else:raise AssertionError('unsupported directory stage')
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
