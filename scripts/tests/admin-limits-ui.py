"""Original subscription quota form with real member-limit replacement/removal."""
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
    raise AssertionError('original limits UI: '+label)


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
if stage in ('limit-zero','limit-high','limit-at-spent'):
    if stage=='limit-zero':
        new_tab(origin+'/#subscription');wait("!!document.querySelector('input[name=email]')",'login prerequisite')
        fill('input[name=email]',control['email']);fill('input[name=password]',control['password']);click('button','登录')
        wait("document.querySelector('h1')?.textContent==='订阅与限量'&&[...document.querySelectorAll('h2')].some(e=>e.textContent==='限量规则')",'original subscription and limits view')
    amount={'limit-zero':0,'limit-high':1000,'limit-at-spent':14}[stage]
    click('button','设置限量');wait("document.querySelectorAll('dialog[open] input').length===2",'original quota form')
    assert js("document.querySelector('dialog[open] select').value")=='member'
    fill('dialog[open] .form-grid > label:nth-child(2) input',control['userId'])
    fill('dialog[open] .form-grid > label:nth-child(3) input',str(amount),replace=True)
    click('button','保存');wait("!document.querySelector('dialog[open]')&&document.querySelector('tbody tr td:nth-child(3)')?.textContent.trim()==="+json.dumps(str(amount)),'member quota original row')
    facts['originalQuotaAmount']=amount
elif stage=='remove-limit':
    click('button','移除')
    wait("document.querySelectorAll('tbody tr').length===0",'original quota removed')
    facts['originalQuotaRemoved']=True
elif stage=='quota-usage-reload':
    cdp('Page.reload')
    wait("document.querySelector('h1')?.textContent==='订阅与限量'&&[...document.querySelectorAll('.stats > div')].find(e=>e.querySelector('span')?.textContent==='已使用')?.querySelector('strong')?.textContent==='28'",'actual consumed credit after reload')
    assert js("document.querySelectorAll('tbody tr').length")==0
    facts['consumed28AndNoRuleAfterReload']=True
else:raise AssertionError('unsupported limits stage')
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
