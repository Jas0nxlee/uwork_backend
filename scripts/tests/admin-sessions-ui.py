"""Original access/distribution model deny form and lifecycle controls."""
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
    raise AssertionError('original policy UI: '+label)


def click(role,name):
    a=[n for n in cdp('Accessibility.getFullAXTree')['nodes'] if not n.get('ignored') and n.get('role',{}).get('value')==role and n.get('name',{}).get('value')==name]
    assert len(a)==1,'unique original control required'
    node=a[0]['backendDOMNodeId'];cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=node)
    q=cdp('DOM.getBoxModel',backendNodeId=node)['model']['content'];click_at_xy(sum(q[0::2])/4,sum(q[1::2])/4)


def focus(selector):
    r=cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result']
    assert r.get('objectId')
    try:
        cdp('DOM.getDocument',depth=0);node=cdp('DOM.requestNode',objectId=r['objectId'])['nodeId'];cdp('DOM.focus',nodeId=node)
    finally:cdp('Runtime.releaseObject',objectId=r['objectId'])


def fill(selector,value,replace=False):
    focus(selector)
    if replace:
        cdp('Input.dispatchKeyEvent',type='keyDown',key='a',code='KeyA',modifiers=4,windowsVirtualKeyCode=65,commands=['selectAll'])
        cdp('Input.dispatchKeyEvent',type='keyUp',key='a',code='KeyA',modifiers=4,windowsVirtualKeyCode=65)
    cdp('Input.insertText',text=value)
    assert js('document.querySelector('+json.dumps(selector)+').value')==value


def rows(count):
    wait("document.querySelector('.table-scroll')?.getAttribute('aria-busy')==='false'&&document.querySelectorAll('tbody tr').length==="+str(count)+"&&document.querySelector('.pagination > span')?.innerText==='共 27 条'",'real paginated session rows')
    return js("[...document.querySelectorAll('tbody tr')].map(e=>{const a=[...e.querySelectorAll('td')].map(e=>e.textContent.trim());return{id:a[0],agentId:a[1],userId:a[2],runCount:Number(a[3])}})")
def query(value):
    fill('input[placeholder=搜索]',value,replace=True);click('button','查询')
facts=dict(stage=stage)
if stage=='sessions-first':
    new_tab(origin+'/#sessions');wait("!!document.querySelector('input[name=email]')",'login')
    fill('input[name=email]',control['email']);fill('input[name=password]',control['password']);click('button','登录');wait("document.querySelector('h1')?.textContent==='会话'",'original sessions view')
    facts['rows']=rows(25)
elif stage in ('sessions-next','sessions-previous'):
    click('button','下一页' if stage=='sessions-next' else '上一页');facts['rows']=rows(2 if stage=='sessions-next' else 25)
elif stage=='sessions-search-detail':
    query(control['sessionSearch']);wait("document.querySelector('.table-scroll')?.getAttribute('aria-busy')==='false'&&document.querySelector('.pagination > span')?.innerText==='共 1 条'&&document.querySelector('tbody tr td')?.textContent.trim()==="+json.dumps(control['sessionSearch']),'exact session search')
    click('button','详情');wait("!!document.querySelector('pre.detail')",'session detail')
    value=js("JSON.parse(document.querySelector('pre.detail').innerText)");assert value['id']==control['sessionSearch'] and value['agent_id']==control['sessionAgentId'] and value['run_count']==1
    click('button','关闭');wait("!document.querySelector('dialog[open]')",'detail closed');facts['exactSessionDetail']=True
elif stage=='sessions-empty':
    query('OWNED_SESSION_NOT_PRESENT');wait("document.querySelector('.table-scroll')?.getAttribute('aria-busy')==='false'&&document.querySelector('.pagination > span')?.innerText==='共 0 条'&&document.querySelector('tbody')?.innerText.includes('暂无记录')",'real empty search')
    assert js("document.querySelector('button[aria-label=上一页]').disabled&&document.querySelector('button[aria-label=下一页]').disabled")
    facts['emptySearchBothPagingControlsDisabled']=True
elif stage=='sessions-reset-reload':
    query('');rows(25);cdp('Page.reload');wait("document.querySelector('h1')?.textContent==='会话'",'sessions page reloaded');facts['rows']=rows(25)
else:raise AssertionError('unsupported sessions stage')
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
