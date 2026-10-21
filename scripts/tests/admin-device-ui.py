"""Original device issuance/list controls, private one-time token handoff only."""
import hashlib
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
    raise AssertionError('original device UI: '+label)


def click(role,label):
    a=[n for n in cdp('Accessibility.getFullAXTree')['nodes'] if not n.get('ignored') and n.get('role',{}).get('value')==role and n.get('name',{}).get('value')==label]
    assert len(a)==1,'unique original device control required'
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
if stage=='issue-original-device':
    new_tab(origin+'/#enterprise');wait("!!document.querySelector('input[name=email]')",'owner login')
    fill('input[name=email]',control['email']);fill('input[name=password]',control['password']);click('button','登录')
    wait("document.querySelector('h1')?.textContent==='企业与企微'&&document.querySelector('.settings-value')?.textContent==='Owned run UI'",'original enterprise loaded')
    click('button','签发凭据');wait("!!document.querySelector('dialog[open] input[type=number]')",'original issuance form')
    fill('dialog[open] input[type=number]','1',replace=True);click('button','保存')
    wait("!!document.querySelector('pre.detail')&&!document.querySelector('dialog[open] input')",'one-time original issuance result')
    data=js("JSON.parse(document.querySelector('pre.detail').textContent)")
    assert set(data)=={'token','id','expiresAt'} and len(data['token'])>=32
    assert hashlib.sha256(data['token'].encode()).hexdigest()==data['id']
    receipt=Path(control['deviceReceiptPath']);assert receipt.parent==Path(os.environ['UWORK_ADMIN_RUN_CONTROL']).parent
    with receipt.open('x') as f:
        os.chmod(receipt,0o600);json.dump(data,f)
    facts['oneTimeReceiptStoredPrivately']=True;click('button','关闭')
elif stage in ('list-device-metadata','list-revoked-device'):
    cdp('Page.reload');wait("document.querySelector('h1')?.textContent==='企业与企微'&&document.querySelector('.settings-value')?.textContent==='Owned run UI'",'reload does not reissue token')
    assert not js("!!document.querySelector('pre.detail')")
    click('button','查看我的终端凭据');wait("!!document.querySelector('pre.detail')",'original device list')
    data=js("JSON.parse(document.querySelector('pre.detail').textContent)")
    issued=json.loads(Path(control['deviceReceiptPath']).read_text())
    if stage=='list-device-metadata':
        assert len(data)==1 and set(data[0])=={'id','created_at','expires_at'}
        assert data[0]['id']==issued['id'] and data[0]['expires_at']==issued['expiresAt']
    else:assert data==[]
    assert issued['token'] not in js('document.body.innerText')
    facts['listedDevices']=len(data);facts['noPlaintextInList']=True;click('button','关闭')
else:raise AssertionError('unsupported device stage')
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
