"""Physical duplicate confirmation and Escape during real DELETE response latency."""
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
    raise AssertionError('pending delete UI: '+label)


def click(role,name):
    nodes=[n for n in cdp('Accessibility.getFullAXTree')['nodes'] if not n.get('ignored') and n.get('role',{}).get('value')==role and n.get('name',{}).get('value')==name]
    assert len(nodes)==1,'unique owned original control required'
    node=nodes[0]['backendDOMNodeId'];cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=node)
    q=cdp('DOM.getBoxModel',backendNodeId=node)['model']['content'];click_at_xy(sum(q[0::2])/4,sum(q[1::2])/4)


def fill(selector,value):
    r=cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result']
    assert r.get('objectId')
    try:
        cdp('DOM.getDocument',depth=0);node=cdp('DOM.requestNode',objectId=r['objectId'])['nodeId'];cdp('DOM.focus',nodeId=node);cdp('Input.insertText',text=value)
    finally:cdp('Runtime.releaseObject',objectId=r['objectId'])


def escape():
    for kind in ['keyDown','keyUp']:cdp('Input.dispatchKeyEvent',type=kind,key='Escape',code='Escape',windowsVirtualKeyCode=27)


facts=dict(stage=stage)
if stage=='double-confirm-and-escape':
    new_tab(origin+'/#automations')
    wait("!!document.querySelector('input[name=email]')",'login prerequisite')
    fill('input[name=email]',control['email']);fill('input[name=password]',control['password']);click('button','登录')
    wait("document.querySelector('h1')?.textContent==='自动化'&&document.querySelector('tbody')?.innerText.includes('Owned in-flight deletion')",'owned plan row')
    click('button','停用或删除')
    wait("!!document.querySelector('dialog[open] button.danger')",'original confirmation')
    p=js("(()=>{const e=document.querySelector('dialog[open] button.danger'),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()")
    click_at_xy(p['x'],p['y']);click_at_xy(p['x'],p['y'])
    escape()
    facts.update(js("(()=>{const d=document.querySelector('dialog[open]');return{confirmDisabled:d?.querySelector('button.danger')?.disabled===true,cancelDisabled:[...d?.querySelectorAll('button')??[]].find(e=>e.textContent.trim()==='取消')?.disabled===true,dialogStillOpen:!!d}})()"))
elif stage=='delete-completed':
    wait("!document.querySelector('dialog[open]')&&!document.querySelector('tbody')?.innerText.includes('Owned in-flight deletion')",'single completed deletion')
    assert not js("!!document.querySelector('[role=alert]')")
    cdp('Page.reload')
    wait("document.querySelector('h1')?.textContent==='自动化'&&document.querySelector('tbody')?.innerText.includes('暂无记录')",'deletion persisted')
    facts['completedOnceNoError']=True
elif stage=='open-concurrent-delete':
    click('button','刷新')
    wait("document.querySelector('tbody')?.innerText.includes('Owned concurrently removed')",'concurrent candidate')
    click('button','停用或删除')
    wait("!!document.querySelector('dialog[open]')",'original stale confirmation')
    facts['openedOriginalConfirmation']=True
elif stage=='missing-error-unlocks':
    click('button','确认')
    wait("document.querySelector('dialog[open] [role=alert]')?.textContent.includes('自动化不存在')&&!document.querySelector('dialog[open] button.danger')?.disabled",'real 404 error and unlocked confirmation')
    escape()
    wait("!document.querySelector('dialog[open]')",'error dismissal through original Escape')
    facts['errorVisibleAndControlsUnlocked']=True
    facts['escapeDismissalAfterFailure']=True
else:raise AssertionError('unsupported deletion stage')
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
