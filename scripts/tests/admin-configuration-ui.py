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


selector='fieldset.configuration .value-grid > label:nth-child(1) input'
def ready(rev,version,value):
    wait("document.querySelector('section[aria-label=当前配置] .section-heading > span')?.textContent==="+json.dumps(f'发布版本 {version} · 草稿修订 {rev}')+"&&!document.querySelector('fieldset.configuration')?.disabled&&document.querySelector("+json.dumps(selector)+")?.value==="+json.dumps(value),'original current configuration revision and value')
def newchat():
    wait("document.querySelector('h1')?.textContent==='客户端定制'",'configuration page');click('button','新对话');wait("!!document.querySelector("+json.dumps(selector)+")",'welcome field')
facts=dict(stage=stage)
if stage=='configuration-save-a':
    new_tab(origin+'/#configuration');wait("!!document.querySelector('input[name=email]')",'login')
    fill('input[name=email]',control['email']);fill('input[name=password]',control['password']);click('button','登录');newchat()
    ready(0,0,control['configurationWelcome']);assert js("[...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='发布').disabled")
    fill(selector,'OWNED_CONFIGURATION_A',replace=True);click('button','保存草稿');ready(1,0,'OWNED_CONFIGURATION_A')
elif stage=='configuration-publish-saved-a':
    fill(selector,'OWNED_CONFIGURATION_B_UNSAVED',replace=True);click('button','发布');ready(2,1,'OWNED_CONFIGURATION_A')
elif stage=='configuration-save-c':
    fill(selector,'OWNED_CONFIGURATION_C',replace=True);click('button','保存草稿');ready(3,1,'OWNED_CONFIGURATION_C')
elif stage=='configuration-discard':
    click('button','放弃草稿');ready(4,1,'OWNED_CONFIGURATION_A')
elif stage=='configuration-edit-stale-d':
    fill(selector,'OWNED_CONFIGURATION_D',replace=True);ready(4,1,'OWNED_CONFIGURATION_D')
elif stage=='configuration-stale-save-rejected':
    click('button','保存草稿');wait("document.querySelector('[role=alert]')?.textContent.includes('配置已被修改')",'real revision conflict');ready(4,1,'OWNED_CONFIGURATION_D')
elif stage=='configuration-reload-e':
    click('button','重新加载');ready(5,1,'OWNED_CONFIGURATION_E');assert not js("!!document.querySelector('[role=alert]')")
elif stage=='configuration-publish-e':
    click('button','发布');ready(6,2,'OWNED_CONFIGURATION_E')
elif stage=='configuration-page-reloaded':
    cdp('Page.reload');newchat();ready(6,2,'OWNED_CONFIGURATION_E')
else:raise AssertionError('unsupported configuration stage')
facts['originalConfigurationAction']=stage
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
