"""Original management interactions at narrow and tablet source-Web viewports."""
import base64
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
    raise AssertionError('original viewport UI: '+label)


def click(role,label):
    a=[n for n in cdp('Accessibility.getFullAXTree')['nodes'] if not n.get('ignored') and n.get('role',{}).get('value')==role and n.get('name',{}).get('value')==label]
    assert len(a)==1,'unique viewport control required'
    node=a[0]['backendDOMNodeId'];cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=node)
    q=cdp('DOM.getBoxModel',backendNodeId=node)['model']['content'];x,y=sum(q[0::2])/4,sum(q[1::2])/4
    viewport=js('({width:innerWidth,height:innerHeight})');assert 0<=x<viewport['width'] and 0<=y<viewport['height'],'control must be inside viewport'
    click_at_xy(x,y)


def fill(selector,value):
    r=cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result'];assert r.get('objectId')
    try:
        cdp('DOM.getDocument',depth=0);node=cdp('DOM.requestNode',objectId=r['objectId'])['nodeId'];cdp('DOM.focus',nodeId=node);cdp('Input.insertText',text=value)
        assert js('document.querySelector('+json.dumps(selector)+').value')==value
    finally:cdp('Runtime.releaseObject',objectId=r['objectId'])


def navigate(label,narrow=False):
    if narrow:
        click('button','导航');wait("document.querySelector('aside')?.classList.contains('open')",'original mobile menu opened')
        wait("document.querySelector('aside').getBoundingClientRect().x>=0",'menu transition settled')
    click('link',label)
    wait("document.querySelector('h1')?.textContent==="+json.dumps(label)+"&&!document.querySelector('aside.open')",'original view and menu state')


def geometry(width):
    d=js("(()=>{const e=document.querySelector('dialog[open]'),r=e?.getBoundingClientRect();return{width:innerWidth,documentWidth:document.documentElement.scrollWidth,dialog:r?{left:r.left,right:r.right,top:r.top,bottom:r.bottom,client:e.clientWidth,scroll:e.scrollWidth}:null}})()")
    assert d['width']==width and d['documentWidth']<=width+1,'document must fit requested source viewport'
    if d['dialog']:
        r=d['dialog'];assert r['left']>=0 and r['right']<=width and r['top']>=0 and r['bottom']<=js('innerHeight')+1 and r['scroll']<=r['client']+1
    return d


def screenshot(name):
    path=Path(control['viewportEvidence'])/name
    assert path.parent.is_dir()
    path.write_bytes(base64.b64decode(cdp('Page.captureScreenshot',format='png')['data']))
    return name


facts=dict(stage=stage)
if stage in ('narrow-create','narrow-capture-only'):
    new_tab(origin+'/#categories');cdp('Emulation.setDeviceMetricsOverride',width=320,height=800,deviceScaleFactor=1,mobile=False)
    wait("!!document.querySelector('input[name=email]')",'narrow login')
    fill('input[name=email]',control['email']);fill('input[name=password]',control['password']);click('button','登录')
    wait("document.querySelector('h1')?.textContent==='资产分类'&&document.querySelector('tbody')?.innerText.includes('暂无记录')",'narrow category list')
    click('button','导航');wait("document.querySelector('aside.open')?.getBoundingClientRect().x>=0",'mobile menu visible')
    click('button','关闭导航');wait("!document.querySelector('aside.open')",'mobile close works')
    wait("document.querySelector('aside').getBoundingClientRect().right<=1",'mobile menu close transition settled')
    click('button','新建');wait("!!document.querySelector('dialog[open] input')",'narrow original form')
    fill('dialog[open] input','Owned narrow category');facts['formGeometry']=geometry(320)
    facts['screenshot']=screenshot('viewport-320-category-form.png')
    if stage=='narrow-capture-only':
        click('button','取消');wait("!document.querySelector('dialog[open]')&&document.querySelector('tbody')?.innerText.includes('暂无记录')",'capture-only cancellation')
    else:
        click('button','保存');wait("!document.querySelector('dialog[open]')&&document.querySelector('tbody')?.innerText.includes('Owned narrow category')",'narrow actual write')
    facts['listGeometry']=geometry(320)
elif stage=='narrow-model-form-cancel':
    navigate('模型管理',narrow=True);wait("document.querySelector('tbody')?.innerText.includes('Owned model')",'narrow model data')
    click('button','编辑');wait("!!document.querySelector('dialog[open] textarea')",'narrow full model editor')
    facts['formGeometry']=geometry(320);facts['screenshot']=screenshot('viewport-320-model-form.png')
    click('button','取消');wait("!document.querySelector('dialog[open]')",'scrollable original form cancel')
elif stage=='tablet-delete-cancel':
    cdp('Emulation.setDeviceMetricsOverride',width=768,height=950,deviceScaleFactor=1,mobile=False)
    navigate('资产分类');wait("document.querySelector('tbody')?.innerText.includes('Owned narrow category')",'tablet original list')
    assert js("document.querySelector('aside').getBoundingClientRect().x")>=0
    click('button','停用或删除');wait("!!document.querySelector('dialog[open]')",'tablet original confirmation')
    facts['dialogGeometry']=geometry(768);facts['screenshot']=screenshot('viewport-768-category-confirm.png')
    click('button','取消');wait("!document.querySelector('dialog[open]')",'tablet cancellation')
    assert js("document.querySelector('tbody').innerText.includes('Owned narrow category')")
elif stage=='tablet-delete-confirm':
    click('button','停用或删除');wait("!!document.querySelector('dialog[open]')",'tablet deletion confirmation')
    click('button','确认');wait("!document.querySelector('dialog[open]')&&document.querySelector('tbody')?.innerText.includes('暂无记录')",'tablet actual deletion')
    cdp('Page.reload');wait("document.querySelector('h1')?.textContent==='资产分类'&&document.querySelector('tbody')?.innerText.includes('暂无记录')",'tablet reload persisted')
    facts['listGeometry']=geometry(768);facts['screenshot']=screenshot('viewport-768-empty.png')
else:raise AssertionError('unsupported viewport stage')
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
