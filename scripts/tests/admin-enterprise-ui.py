"""Original enterprise metadata, role and retention controls; own fixture only."""
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
    raise AssertionError('original enterprise UI: '+label)


def click(role,name):
    a=[n for n in cdp('Accessibility.getFullAXTree')['nodes'] if not n.get('ignored') and n.get('role',{}).get('value')==role and n.get('name',{}).get('value')==name]
    assert len(a)==1,'unique original control required'
    node=a[0]['backendDOMNodeId'];cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=node)
    q=cdp('DOM.getBoxModel',backendNodeId=node)['model']['content'];click_at_xy(sum(q[0::2])/4,sum(q[1::2])/4)


def fill(selector,value,replace=False):
    r=cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result'];assert r.get('objectId')
    try:
        cdp('DOM.getDocument',depth=0);node=cdp('DOM.requestNode',objectId=r['objectId'])['nodeId'];cdp('DOM.focus',nodeId=node)
        if replace:
            cdp('Input.dispatchKeyEvent',type='keyDown',key='a',code='KeyA',modifiers=4,windowsVirtualKeyCode=65,commands=['selectAll'])
            cdp('Input.dispatchKeyEvent',type='keyUp',key='a',code='KeyA',modifiers=4,windowsVirtualKeyCode=65)
        cdp('Input.insertText',text=value)
        assert js('document.querySelector('+json.dumps(selector)+').value')==value
    finally:cdp('Runtime.releaseObject',objectId=r['objectId'])


facts=dict(stage=stage)
if stage=='rename-enterprise':
    new_tab(origin+'/#enterprise');wait("!!document.querySelector('input[name=email]')",'login prerequisite')
    fill('input[name=email]',control['email']);fill('input[name=password]',control['password']);click('button','登录')
    wait("document.querySelector('h1')?.textContent==='企业与企微'&&document.querySelector('.settings-value')?.textContent==='Owned run UI'",'original enterprise data loaded')
    click('button','修改企业信息');wait("document.querySelectorAll('dialog[open] input').length===2",'original enterprise form')
    fill('dialog[open] .form-grid > label:nth-child(1) input','Owned enterprise revised',replace=True)
    fill('dialog[open] .form-grid > label:nth-child(2) input','owned-contact@example.test')
    click('button','保存');wait("!document.querySelector('dialog[open]')&&document.querySelector('.settings-value')?.textContent==='Owned enterprise revised'",'enterprise page renamed')
    facts.update(js("(()=>{const s=document.querySelector('select[aria-label=当前组织]');return{selectedTenantId:s.value,selectedTenantName:s.selectedOptions[0].textContent.trim(),enterpriseLabel:document.querySelector('.settings-value').textContent,profileName:document.querySelector('.profile strong').textContent}})()"))
elif stage=='enterprise-reload-roles':
    cdp('Page.reload');wait("document.querySelector('.settings-value')?.textContent==='Owned enterprise revised'&&document.querySelector('select[aria-label=当前组织]')?.selectedOptions[0]?.textContent.trim()==='Owned enterprise revised'",'renamed metadata after reload')
    click('button','角色权限');wait("!!document.querySelector('pre.detail')",'real role permissions')
    d=js("JSON.parse(document.querySelector('pre.detail').textContent)")
    assert set(d['roles'])=={'owner','admin','operator','auditor','member'} and d['permissions']['member']==['execute']
    assert 'vault' in d['permissions']['owner'] and 'vault' not in d['permissions']['operator']
    facts['realRolePermissionContract']=True;click('button','关闭')
elif stage=='set-retention':
    click('button','设置留存');wait("!!document.querySelector('dialog[open] input[type=number]')",'original retention form')
    fill('dialog[open] input[type=number]','7',replace=True);click('button','保存')
    wait("!document.querySelector('dialog[open]')&&document.body.innerText.includes('已配置：保留 7 天')",'retention value in original page')
    facts['originalRetentionConfigured7']=True
elif stage=='purge-recent-only':
    click('button','立即清理');wait("!!document.querySelector('pre.detail')",'original purge result')
    d=js("JSON.parse(document.querySelector('pre.detail').textContent)")
    assert isinstance(d,dict) and d and all(value==0 for value in d.values())
    facts['recentOnlyCleanupCountsZero']=True;facts['resultKeys']=sorted(d.keys());click('button','关闭')
else:raise AssertionError('unsupported enterprise stage')
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
