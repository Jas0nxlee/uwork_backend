"""Original skill asset create/review/publish/version editor in owned browser-harness."""
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
    raise AssertionError('original assets UI: '+label)


def click(role,name):
    a=[n for n in cdp('Accessibility.getFullAXTree')['nodes'] if not n.get('ignored') and n.get('role',{}).get('value')==role and n.get('name',{}).get('value')==name]
    assert len(a)==1,'unique owned original control required'
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


def version_action(action,version):
    click('button',action)
    wait("!!document.querySelector('dialog[open] input[type=number]')",'original version form')
    fill('dialog[open] input[type=number]',str(version),replace=True)
    click('button','保存')


facts=dict(stage=stage)
if stage=='create-skill':
    new_tab(origin+'/#assets');wait("!!document.querySelector('input[name=email]')",'login prerequisite')
    fill('input[name=email]',control['email']);fill('input[name=password]',control['password']);click('button','登录')
    wait("document.querySelector('h1')?.textContent==='技能与资产'",'original asset view')
    click('button','新建');wait("document.querySelectorAll('dialog[open] textarea').length===3",'original asset JSON form')
    fill('dialog[open] .form-grid > label:nth-child(1) input','Owned UI skill')
    fill('dialog[open] .form-grid > label:nth-child(3) textarea',json.dumps(control['contentV1']),replace=True)
    fill('dialog[open] .form-grid > label:nth-child(4) textarea',json.dumps(dict(all=True)),replace=True)
    click('button','保存');wait("!document.querySelector('dialog[open]')&&document.querySelector('tbody')?.innerText.includes('Owned UI skill')",'skill draft created')
    facts['originalSkillCreated']=True
elif stage=='publish-unreviewed':
    version_action('发布',1)
    wait("document.querySelector('dialog[open] [role=alert]')?.textContent.includes('版本必须审核通过')",'real review-required error')
    click('button','取消');facts['unreviewedPublishRejectedVisibly']=True
elif stage in ('review-v1','publish-v1','review-v2','publish-v2'):
    version=1 if stage.endswith('v1') else 2
    version_action('审核' if stage.startswith('review') else '发布',version)
    wait("!document.querySelector('dialog[open]')",'original version action completed')
    if stage.startswith('publish'):
        wait("document.querySelector('tbody tr td:nth-child(4)')?.textContent.trim()==="+json.dumps(str(version)),'published version row')
    facts['originalVersionActionAccepted']=True
    facts['version']=version
elif stage=='edit-skill-v2':
    click('button','编辑');wait("document.querySelectorAll('dialog[open] textarea').length===3",'original skill editor')
    assert js("JSON.parse(document.querySelector('dialog[open] .form-grid > label:nth-child(3) textarea').value)")['files']==control['contentV1']['files']
    fill('dialog[open] .form-grid > label:nth-child(3) textarea',json.dumps(control['contentV2']),replace=True)
    click('button','保存');wait("!document.querySelector('dialog[open]')",'original new skill version saved')
    facts['v2DraftEditedThroughOriginalForm']=True
elif stage=='disable-skill':
    click('button','停用或删除');wait("!!document.querySelector('dialog[open]')",'original disable confirmation')
    click('button','确认');wait("!document.querySelector('dialog[open]')&&document.querySelector('tbody tr td:nth-child(5)')?.textContent.trim()==='否'",'skill disabled')
    cdp('Page.reload');wait("document.querySelector('h1')?.textContent==='技能与资产'&&document.querySelector('tbody tr td:nth-child(5)')?.textContent.trim()==='否'",'disabled skill after reload')
    facts['disabledPersistsAfterReload']=True
else:raise AssertionError('unsupported asset stage')
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
