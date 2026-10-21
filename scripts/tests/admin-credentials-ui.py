"""Original Vault password forms and public metadata; no secret output or screenshot."""
import json
import os
from pathlib import Path
import time
from urllib.parse import urlparse

control=json.loads(Path(os.environ['UWORK_ADMIN_RUN_CONTROL']).read_text())
stage=os.environ['UWORK_EXPERIENCE_STAGE'];origin=control['origin']
assert urlparse(origin).hostname=='127.0.0.1' and urlparse(origin).port!=3000
name='Owned UI gateway key'


def wait(expression,label):
    end=time.monotonic()+20
    while time.monotonic()<end:
        if js(expression):return
        time.sleep(.1)
    raise AssertionError('original credential UI: '+label)


def click(role,label):
    a=[n for n in cdp('Accessibility.getFullAXTree')['nodes'] if not n.get('ignored') and n.get('role',{}).get('value')==role and n.get('name',{}).get('value')==label]
    assert len(a)==1,'unique original control required'
    node=a[0]['backendDOMNodeId'];cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=node)
    q=cdp('DOM.getBoxModel',backendNodeId=node)['model']['content'];click_at_xy(sum(q[0::2])/4,sum(q[1::2])/4)


def fill(selector,value):
    r=cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result'];assert r.get('objectId')
    try:
        cdp('DOM.getDocument',depth=0);node=cdp('DOM.requestNode',objectId=r['objectId'])['nodeId'];cdp('DOM.focus',nodeId=node);cdp('Input.insertText',text=value)
    finally:cdp('Runtime.releaseObject',objectId=r['objectId'])


row="[...document.querySelectorAll('tbody tr')].find(e=>e.querySelector('td')?.textContent.trim()==="+json.dumps(name)+")"
def action(label):
    wait('!!('+row+')','owned credential metadata row')
    p=js("(()=>{const e=("+row+").querySelector('button[aria-label="+json.dumps(label)+"]');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{ok:e.contains(document.elementFromPoint(x,y)),x,y}})()")
    assert p['ok'];click_at_xy(p['x'],p['y'])


facts=dict(stage=stage)
if stage=='create-ui-credential':
    new_tab(origin+'/#credentials');wait("!!document.querySelector('input[name=email]')",'login prerequisite')
    fill('input[name=email]',control['email']);fill('input[name=password]',control['password']);click('button','登录')
    wait("document.querySelector('h1')?.textContent==='凭据管理'&&!!document.querySelector('tbody')",'original credential view')
    click('button','新建');wait("!!document.querySelector('dialog[open] input[type=password]')",'original secret password field')
    fill('dialog[open] .form-grid > label:nth-child(1) input',name)
    fill('dialog[open] input[type=password]',control['keyInitial'])
    click('button','保存');wait("!document.querySelector('dialog[open]')&&!!("+row+")",'original credential created')
    facts['createdViaPasswordForm']=True
elif stage in ('rotate-ui-credential','restore-ui-credential'):
    action('编辑');wait("!!document.querySelector('dialog[open] input[type=password]')",'original rotation password field')
    assert js("document.querySelector('dialog[open] input[type=password]').value===''")
    fill('dialog[open] input[type=password]',control['keyRotated'] if stage=='rotate-ui-credential' else control['keyRestored'])
    click('button','保存');wait("!document.querySelector('dialog[open]')",'original rotation completed')
    version='2' if stage=='rotate-ui-credential' else '3'
    wait('('+row+").querySelector('td:nth-child(3)')?.textContent.trim()==="+json.dumps(version),'actual Vault revision row')
    facts['rotationDoesNotPrefillOldSecret']=True
    facts['revision']=int(version)
elif stage in ('revoke-cancel','revoke-confirm'):
    action('停用或删除');wait("!!document.querySelector('dialog[open]')",'original revoke confirmation')
    click('button','取消' if stage=='revoke-cancel' else '确认');wait("!document.querySelector('dialog[open]')",'original revoke dialog completed')
    if stage=='revoke-confirm':wait('('+row+").querySelector('td:nth-child(4)')?.textContent.trim()==='1'",'actual revoked metadata')
    facts['originalRevokeDialogCompleted']=True
elif stage=='public-credential-detail':
    action('详情');wait("!!document.querySelector('pre.detail')",'original public credential detail')
    data=js("JSON.parse(document.querySelector('pre.detail').textContent)")
    assert set(data)=={'id','name','revision','revoked','created_at','updated_at'}
    assert data['name']==name and data['revision']==3 and data['revoked']==0
    facts['onlyPublicMetadataFields']=sorted(data.keys())
    click('button','关闭');cdp('Page.reload')
    wait("document.querySelector('h1')?.textContent==='凭据管理'&&!!("+row+")&&("+row+").querySelector('td:nth-child(3)')?.textContent.trim()==='3'",'restored revision persists after reload')
    facts['restoredMetadataAfterReload']=True
else:raise AssertionError('unsupported credential stage')
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
