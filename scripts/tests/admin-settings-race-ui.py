"""Two original quota remove buttons with one genuine old response delivered last."""
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
    raise AssertionError('original Settings read order: '+label)


def click(role,name):
    a=[n for n in cdp('Accessibility.getFullAXTree')['nodes'] if not n.get('ignored') and n.get('role',{}).get('value')==role and n.get('name',{}).get('value')==name]
    assert len(a)==1,'unique original control required'
    node=a[0]['backendDOMNodeId'];cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=node)
    q=cdp('DOM.getBoxModel',backendNodeId=node)['model']['content'];click_at_xy(sum(q[0::2])/4,sum(q[1::2])/4)


def fill(selector,value):
    r=cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result'];assert r.get('objectId')
    try:
        cdp('DOM.getDocument',depth=0);node=cdp('DOM.requestNode',objectId=r['objectId'])['nodeId'];cdp('DOM.focus',nodeId=node);cdp('Input.insertText',text=value)
    finally:cdp('Runtime.releaseObject',objectId=r['objectId'])


def remove(subject):
    p=js("(()=>{const a=[...document.querySelectorAll('tbody tr')].filter(e=>e.querySelector('td:nth-child(2)')?.textContent.trim()==="+json.dumps(subject)+");if(a.length!==1)return{ok:false};const e=a[0].querySelector('button');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{ok:e.contains(document.elementFromPoint(x,y)),x,y}})()")
    assert p['ok'];click_at_xy(p['x'],p['y'])


read_count="performance.getEntriesByType('resource').filter(e=>new URL(e.name).pathname.endsWith('/limits')).length"
facts=dict(stage=stage)
if stage=='remove-member':
    new_tab(origin+'/#subscription')
    cdp('Network.enable')
    cdp('Network.setCacheDisabled',cacheDisabled=True)
    wait("!!document.querySelector('input[name=email]')",'login prerequisite')
    fill('input[name=email]',control['email']);fill('input[name=password]',control['password']);click('button','登录')
    wait("document.querySelector('h1')?.textContent==='订阅与限量'&&document.querySelectorAll('tbody tr').length===2",'original two quota rows')
    remove(control['userId']);facts['firstOriginalRemoveClicked']=True;facts['ownedBrowserCacheDisabled']=True
elif stage=='remove-application':
    remove('uwork')
    try:
        wait("document.querySelectorAll('tbody tr').length===0",'newer original load emptied UI')
    except AssertionError:
        print('OWNED_LIMIT_RACE_DIAGNOSTIC='+json.dumps(js("(()=>({title:document.querySelector('h1')?.textContent,rows:[...document.querySelectorAll('tbody tr')].map(e=>[...e.querySelectorAll('td')].slice(0,3).map(c=>c.textContent)),errors:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent)}))()")))
        raise
    facts['completedReadsBeforeRelease']=js(read_count)
    facts['freshUiEmpty']=True
elif stage=='observe-late-reply':
    wait(read_count+'>'+str(control['completedReadsBeforeRelease']),'held original resource response completed in browser')
    observations=[]
    for _ in range(20):
        observations.append(js("(()=>({rows:document.querySelectorAll('tbody tr').length,subjects:[...document.querySelectorAll('tbody tr')].map(e=>e.querySelector('td:nth-child(2)')?.textContent)}))()"))
        time.sleep(.05)
    facts['observations']=observations
    facts['completedReadsAfterRelease']=js(read_count)
else:raise AssertionError('unsupported Settings read-order stage')
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
