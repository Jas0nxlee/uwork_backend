"""Original asset category creation, duplicate rejection and reference-aware deletion."""
import json
import os
from pathlib import Path
import time
from urllib.parse import urlparse

control=json.loads(Path(os.environ['UWORK_ADMIN_RUN_CONTROL']).read_text())
stage=os.environ['UWORK_EXPERIENCE_STAGE'];origin=control['origin']
assert urlparse(origin).hostname=='127.0.0.1' and urlparse(origin).port!=3000
name='Owned UI skill category'


def wait(expression,label):
    end=time.monotonic()+20
    while time.monotonic()<end:
        if js(expression):return
        time.sleep(.1)
    raise AssertionError('original category UI: '+label)


def click(role,label):
    a=[n for n in cdp('Accessibility.getFullAXTree')['nodes'] if not n.get('ignored') and n.get('role',{}).get('value')==role and n.get('name',{}).get('value')==label]
    assert len(a)==1,'unique original control required'
    node=a[0]['backendDOMNodeId'];cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=node)
    q=cdp('DOM.getBoxModel',backendNodeId=node)['model']['content'];click_at_xy(sum(q[0::2])/4,sum(q[1::2])/4)


def fill(selector,value):
    r=cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result'];assert r.get('objectId')
    try:
        cdp('DOM.getDocument',depth=0);node=cdp('DOM.requestNode',objectId=r['objectId'])['nodeId'];cdp('DOM.focus',nodeId=node);cdp('Input.insertText',text=value)
    finally:cdp('Runtime.releaseObject',objectId=r['objectId'])


facts=dict(stage=stage)
if stage in ('create-category','duplicate-category'):
    if stage=='create-category':
        new_tab(origin+'/#categories');wait("!!document.querySelector('input[name=email]')",'login prerequisite')
        fill('input[name=email]',control['email']);fill('input[name=password]',control['password']);click('button','登录')
        wait("document.querySelector('h1')?.textContent==='资产分类'",'original category view')
    click('button','新建');wait("!!document.querySelector('dialog[open] input')",'original category form')
    fill('dialog[open] input',name)
    assert js("document.querySelector('dialog[open] select').value")=='skill'
    click('button','保存')
    if stage=='create-category':
        wait("!document.querySelector('dialog[open]')&&document.querySelector('tbody')?.innerText.includes('Owned UI skill category')",'original category created')
        facts['categoryCreatedViaOriginalForm']=True
    else:
        wait("document.querySelector('dialog[open] [role=alert]')?.textContent.includes('分类已存在')",'real duplicate category error')
        click('button','取消');facts['duplicateRejectedVisibly']=True
elif stage in ('delete-current-reference','delete-published-reference','delete-category-cancel','delete-category-confirm'):
    click('button','停用或删除');wait("!!document.querySelector('dialog[open]')",'original category confirmation')
    click('button','取消' if stage=='delete-category-cancel' else '确认')
    if stage.startswith('delete-') and stage.endswith('reference'):
        wait("document.querySelector('dialog[open] [role=alert]')?.textContent.includes('分类仍有资产')",'real reference refusal')
        click('button','取消');facts['referencedCategoryProtectedVisibly']=True
    elif stage=='delete-category-cancel':
        wait("!document.querySelector('dialog[open]')",'cancelled deletion')
        assert js("document.querySelector('tbody').innerText.includes('Owned UI skill category')")
        facts['cancelPreservesCategory']=True
    else:
        wait("!document.querySelector('dialog[open]')&&document.querySelector('tbody')?.innerText.includes('暂无记录')",'category removed')
        cdp('Page.reload');wait("document.querySelector('h1')?.textContent==='资产分类'&&document.querySelector('tbody')?.innerText.includes('暂无记录')",'category absent after reload')
        facts['categoryDeletionPersists']=True
else:raise AssertionError('unsupported category stage')
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
