"""Real role-specific management consumers and stale-modal authorization."""
import json
import os
from pathlib import Path
import time
from urllib.parse import urlparse

control=json.loads(Path(os.environ['UWORK_ADMIN_RUN_CONTROL']).read_text())
origin=control['origin'];stage=os.environ['UWORK_EXPERIENCE_STAGE']
assert urlparse(origin).hostname=='127.0.0.1' and urlparse(origin).port!=3000


def wait(expression,label):
    end=time.monotonic()+20
    while time.monotonic()<end:
        if js(expression):return
        time.sleep(.1)
    raise AssertionError('original role UI: '+label)


def click(role,label):
    a=[n for n in cdp('Accessibility.getFullAXTree')['nodes'] if not n.get('ignored') and n.get('role',{}).get('value')==role and n.get('name',{}).get('value')==label]
    assert len(a)==1,'unique original role control required'
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


def view(label):
    click('link',label)
    wait("document.querySelector('h1')?.textContent==="+json.dumps(label),'original role navigation')


facts=dict(stage=stage)
if stage=='admin-open-stale-editor':
    new_tab(origin+'/#models');wait("!!document.querySelector('input[name=email]')",'subject login')
    fill('input[name=email]',control['email']);fill('input[name=password]',control['password']);click('button','登录')
    wait("document.querySelector('.profile small')?.textContent==='admin'&&document.querySelector('tbody')?.innerText.includes('Owned model')",'admin model loaded')
    click('button','编辑');wait("!!document.querySelector('dialog[open] input')",'authorized editor open')
    fill('dialog[open] .form-grid > label:nth-child(1) input','Forbidden stale model name',replace=True)
    facts['editorOpenedBeforeRoleChange']=True
elif stage=='reject-stale-admin-write':
    assert js("document.querySelector('.profile small').textContent")=='admin'
    click('button','保存');wait("document.querySelector('dialog[open] [role=alert]')?.textContent.includes('没有此操作权限')",'real forbidden stale write')
    click('button','取消');wait("!document.querySelector('dialog[open]')",'rejected editor cancel')
    facts['staleRoleWriteVisiblyRejected']=True
elif stage=='auditor-readonly-controls':
    cdp('Page.reload');wait("document.querySelector('.profile small')?.textContent==='auditor'&&document.querySelector('tbody')?.innerText.includes('Owned model')",'current auditor loaded')
    assert not js("Array.from(document.querySelectorAll('main button')).some(e=>['新建','编辑','停用或删除','测试连接'].includes(e.getAttribute('aria-label')||e.textContent.trim()))")
    click('button','详情');wait("!!document.querySelector('pre.detail')",'auditor model metadata')
    d=js("JSON.parse(document.querySelector('pre.detail').textContent)");assert d['id']==control['modelId'] and d['name']=='Owned model'
    click('button','关闭');view('成员与席位')
    wait("document.querySelector('tbody')?.innerText.includes('Owned role subject')",'auditor members readable')
    assert not js("Array.from(document.querySelectorAll('main button')).some(e=>['新建','编辑','停用或删除'].includes(e.getAttribute('aria-label')||e.textContent.trim())||(e.getAttribute('aria-label')||'').includes('企微身份'))")
    view('客户端定制');wait("!!document.querySelector('fieldset.policy-fieldset[disabled]')",'auditor configuration read-only')
    assert not js("!!document.querySelector('fieldset.policy-fieldset button:not(:disabled),fieldset.policy-fieldset input:not(:disabled),fieldset.policy-fieldset select:not(:disabled)')")
    facts['readonlyCollectionsAndConfiguration']=True
elif stage=='auditor-protected-enterprise-and-vault':
    view('企业与企微');wait("document.querySelector('.settings-value')?.textContent==='Owned run UI'",'auditor enterprise readable')
    click('button','修改企业信息');wait("!!document.querySelector('dialog[open] input')",'original enterprise form')
    fill('dialog[open] .form-grid > label:nth-child(1) input','Forbidden auditor tenant name',replace=True)
    click('button','保存');wait("document.querySelector('dialog[open] [role=alert]')?.textContent.includes('没有此操作权限')",'identity permission checked by backend')
    click('button','取消');view('凭据管理')
    wait("document.querySelector('main [role=alert]')?.textContent.includes('没有此操作权限')",'vault read forbidden')
    assert js("document.querySelector('tbody').innerText.includes('暂无记录')")
    assert not js("Array.from(document.querySelectorAll('main button')).some(e=>e.textContent.trim()==='新建')")
    facts['enterpriseWriteAndVaultReadRejected']=True
elif stage=='operator-permitted-category-write':
    cdp('Page.reload');wait("document.querySelector('.profile small')?.textContent==='operator'",'current operator loaded')
    view('资产分类');wait("document.querySelector('tbody')?.innerText.includes('暂无记录')",'operator category loaded')
    click('button','新建');wait("!!document.querySelector('dialog[open] input')",'operator original category form')
    fill('dialog[open] input','Owned operator category');click('button','保存')
    wait("!document.querySelector('dialog[open]')&&document.querySelector('tbody')?.innerText.includes('Owned operator category')",'permitted operator write')
    facts['operatorOriginalWriteSucceeds']=True
elif stage=='member-no-admin-consumer':
    cdp('Page.reload');wait("document.querySelector('.profile small')?.textContent==='member'&&document.querySelector('main')?.innerText.includes('当前成员没有管理端权限')",'member boundary after reload')
    for label in ['模型管理','成员与席位','企业与企微','订阅与限量','客户端定制']:
        view(label)
        assert js("document.querySelector('main').innerText.includes('当前成员没有管理端权限')&&!document.querySelector('main table,main .settings-section,main form,main fieldset')")
    facts['memberManagementViewsDoNotMount']=True
else:raise AssertionError('unsupported role stage')
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
