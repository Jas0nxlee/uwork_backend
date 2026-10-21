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
if stage=='subscription-seat-conflict':
    new_tab(origin+'/#subscription');wait("!!document.querySelector('input[name=email]')",'login prerequisite')
    fill('input[name=email]',control['email']);fill('input[name=password]',control['password']);click('button','登录')
    wait("document.querySelector('h1')?.textContent==='订阅与限量'&&[...document.querySelectorAll('button')].some(e=>e.innerText.trim()==='调整订阅')",'original subscription view')
if stage=='subscription-reloaded':
    cdp('Page.reload')
    wait("document.querySelector('h1')?.textContent==='订阅与限量'&&[...document.querySelectorAll('.stats strong')].map(e=>e.textContent).join(',')==='2,2,1000,28'",'renewed subscription stats persist')
    assert js("document.querySelectorAll('tbody tr').length")==0
    facts['stats']=[2,2,1000,28]
else:
    assert stage in ('subscription-seat-conflict','subscription-zero','subscription-credit-restore','subscription-expired','subscription-renew')
    click('button','调整订阅');wait("document.querySelectorAll('dialog[open] input').length===4",'original subscription form')
    seats=1 if stage=='subscription-seat-conflict' else 2
    credits=0 if stage=='subscription-zero' else 1000
    end=control['subscriptionExpiredEnd'] if stage=='subscription-expired' else control['subscriptionEnd']
    for index,value in enumerate([seats,credits,control['subscriptionStart'],end],1):
        fill('dialog[open] .form-grid > label:nth-child('+str(index)+') input',str(value),replace=True)
    # 用原生键盘选择订阅月，不写DOM选项值。
    r=cdp('Runtime.evaluate',expression="document.querySelector('dialog[open] select')",returnByValue=False)['result'];assert r.get('objectId')
    try:
        cdp('DOM.getDocument',depth=0);node=cdp('DOM.requestNode',objectId=r['objectId'])['nodeId'];cdp('DOM.focus',nodeId=node)
        for char in '订阅月':cdp('Input.dispatchKeyEvent',type='char',text=char,unmodifiedText=char)
        for kind in ['keyDown','keyUp']:cdp('Input.dispatchKeyEvent',type=kind,key='Tab',code='Tab',windowsVirtualKeyCode=9)
    finally:cdp('Runtime.releaseObject',objectId=r['objectId'])
    assert js("document.querySelector('dialog[open] select').value")=='subscription'
    click('button','保存')
    if stage=='subscription-seat-conflict':
        wait("document.body.innerText.includes('席位数小于已分配数量')&&!!document.querySelector('dialog[open]')",'server rejected lower seats without dismissing edit')
        click('button','取消');wait("!document.querySelector('dialog[open]')",'cancel rejected seat edit')
        facts['rejectedSeatCount']=1
    else:
        wait("!document.querySelector('dialog[open]')&&[...document.querySelectorAll('.stats > div')].find(e=>e.querySelector('span')?.textContent==='周期 Credit')?.querySelector('strong')?.textContent==="+json.dumps(str(credits)),'subscription saved and actual view reloaded')
        facts.update(seats=seats,credits=credits,metering='subscription')
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
