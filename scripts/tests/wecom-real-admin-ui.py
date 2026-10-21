"""Runs inside owned browser-harness; outputs aggregates, never directory contents."""
import json
import os
import time
from pathlib import Path
from urllib.parse import urlparse

control_path = Path(os.environ['UWORK_WECOM_UI_CONTROL'])
control = json.loads(control_path.read_text())
stage = os.environ['UWORK_EXPERIENCE_STAGE']
origin = control['origin']
assert urlparse(origin).hostname == '127.0.0.1' and urlparse(origin).port != 3000

def wait(expression, label):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if js(expression): return
        time.sleep(.1)
    raise AssertionError('UI condition failed: ' + label)

def click_ax(role, name):
    nodes = cdp('Accessibility.getFullAXTree')['nodes']
    found = [n for n in nodes if not n.get('ignored') and n.get('role',{}).get('value') == role and n.get('name',{}).get('value') == name]
    assert len(found) == 1, 'expected unique owned control'
    node = found[0]['backendDOMNodeId']
    cdp('DOM.scrollIntoViewIfNeeded', backendNodeId=node)
    q = cdp('DOM.getBoxModel', backendNodeId=node)['model']['content']
    click_at_xy(sum(q[0::2])/4, sum(q[1::2])/4)

def fill(selector, value):
    remote = cdp('Runtime.evaluate', expression='document.querySelector('+json.dumps(selector)+')', returnByValue=False)['result']
    assert remote.get('objectId')
    try:
        cdp('DOM.getDocument', depth=0)
        node = cdp('DOM.requestNode', objectId=remote['objectId'])['nodeId']
        cdp('DOM.focus', nodeId=node)
        cdp('Input.insertText', text=value)
    finally:
        cdp('Runtime.releaseObject', objectId=remote['objectId'])

facts = {'stage':stage}
if stage == 'login-config':
    new_tab(origin)
    wait("!!document.querySelector('input[name=email]')", 'login form')
    if control['development']:
        assert js("!!document.querySelector('script[type=module][src=\"/src/main.tsx\"]')")
        facts['sourceModuleEntry']=True
    fill('input[name=email]', control['email'])
    fill('input[name=password]', control['password'])
    click_ax('button','登录')
    wait("!!document.querySelector('a[href=\"#enterprise\"]')", 'authenticated navigation')
    click_ax('link','企业与企微')
    wait("[...document.querySelectorAll('h2')].some(e=>e.textContent==='企业微信')", 'WeCom section')
    click_ax('button','应用与回调')
    wait("!!document.querySelector('pre.detail')", 'configuration detail')
    expected = json.dumps({'corp':control['corpId'],'agent':control['agentId'],'origin':origin})
    value = js("(()=>{const q="+expected+",d=JSON.parse(document.querySelector('pre.detail').textContent);return {corpMatches:d.configuration.corp_id===q.corp,agentMatches:d.configuration.agent_id===q.agent,callbackOwned:new URL(d.callbackUrl).origin===q.origin,credentialReferenceOnly:typeof d.configuration.credential_id==='string'&&!('secret' in d.configuration)}})()")
    assert all(value.values())
    facts.update(value)
    click_ax('button','关闭')
    wait("!document.querySelector('dialog[open]')", 'configuration dialog closed')
elif stage == 'switch':
    cdp('Page.reload')
    wait("document.querySelectorAll('select[aria-label=当前组织] option').length===2", 'two owned organization choices')
    for tenant in [control['secondaryTenant'],control['primaryTenant']]:
        selector='select[aria-label="当前组织"]'
        info=js("(()=>{const s=document.querySelector("+json.dumps(selector)+");return{current:s.selectedIndex,labels:[...s.options].map(o=>o.textContent),target:[...s.options].findIndex(o=>o.value==="+json.dumps(tenant)+")}})()")
        assert info['target']>=0 and info['target']!=info['current']
        remote=cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result']
        cdp('DOM.getDocument',depth=0)
        node=cdp('DOM.requestNode',objectId=remote['objectId'])['nodeId']
        cdp('DOM.focus',nodeId=node)
        cdp('Runtime.releaseObject',objectId=remote['objectId'])
        prefix=info['labels'][info['target']][0]
        assert sum(label.casefold().startswith(prefix.casefold()) for label in info['labels']) == 1
        cdp('Input.dispatchKeyEvent',type='char',text=prefix,unmodifiedText=prefix)
        cdp('Input.dispatchKeyEvent',type='rawKeyDown',key='Tab',code='Tab',windowsVirtualKeyCode=9,modifiers=0)
        cdp('Input.dispatchKeyEvent',type='keyUp',key='Tab',code='Tab',windowsVirtualKeyCode=9)
        wait('document.querySelector('+json.dumps(selector)+').value==='+json.dumps(tenant), 'organization selected')
        # 后端响应驱动 me 的受控 select；reload 进一步证明 Cookie 的新 tenant。
        cdp('Page.reload')
        wait('document.querySelector('+json.dumps(selector)+')?.value==='+json.dumps(tenant), 'organization cookie persisted')
    facts['roundTripPersisted']=True
elif stage in ['sync-first','sync-repeat']:
    if stage == 'sync-repeat':
        cdp('Page.reload')
        wait("[...document.querySelectorAll('h2')].some(e=>e.textContent==='企业微信')", 'section after reload')
    click_ax('button','同步通讯录')
    wait("document.body.innerText.includes('通讯录已同步')", 'real sync success notification')
    facts['successNotification']=True
elif stage == 'directory':
    counts = json.loads((control_path.parent/'counts.json').read_text())
    click_ax('link','成员与席位')
    wait("document.querySelectorAll('tbody tr').length==="+str(counts['members']), 'member rows')
    facts['memberRows']=js("document.querySelectorAll('tbody tr').length")
    facts['wecomMemberRows']=js("[...document.querySelectorAll('tbody tr')].filter(e=>e.textContent.includes('wecom')).length")
    assert facts['wecomMemberRows'] > 0
    click_ax('link','部门')
    wait("document.querySelectorAll('tbody tr').length==="+str(counts['departments']), 'department rows')
    facts['departmentRows']=js("document.querySelectorAll('tbody tr').length")
elif stage == 'logout':
    click_ax('button','退出登录')
    wait("!!document.querySelector('input[name=password]')", 'signed out')
    cdp('Page.reload')
    wait("!!document.querySelector('input[name=password]')", 'signed out after reload')
    facts['logoutPersisted']=True
else:
    raise AssertionError('unsupported owned stage')
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
