"""Original filtered CSV links and actual private browser downloads."""
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import time
from urllib.parse import urlparse,parse_qs

control_path=Path(os.environ['UWORK_ADMIN_RUN_CONTROL']);control=json.loads(control_path.read_text())
origin=control['origin'];assert urlparse(origin).hostname=='127.0.0.1' and urlparse(origin).port!=3000
assert os.environ['UWORK_EXPERIENCE_STAGE']=='export-all'


def wait(expression,label):
    end=time.monotonic()+20
    while time.monotonic()<end:
        if js(expression):return
        time.sleep(.1)
    raise AssertionError('original CSV UI: '+label)


def click(role,label):
    a=[n for n in cdp('Accessibility.getFullAXTree')['nodes'] if not n.get('ignored') and n.get('role',{}).get('value')==role and n.get('name',{}).get('value')==label]
    assert len(a)==1,'unique original CSV control required'
    node=a[0]['backendDOMNodeId'];cdp('DOM.scrollIntoViewIfNeeded',backendNodeId=node)
    q=cdp('DOM.getBoxModel',backendNodeId=node)['model']['content'];click_at_xy(sum(q[0::2])/4,sum(q[1::2])/4)


def fill(selector,value):
    r=cdp('Runtime.evaluate',expression='document.querySelector('+json.dumps(selector)+')',returnByValue=False)['result'];assert r.get('objectId')
    try:
        cdp('DOM.getDocument',depth=0);node=cdp('DOM.requestNode',objectId=r['objectId'])['nodeId'];cdp('DOM.focus',nodeId=node);cdp('Input.insertText',text=value)
        assert js('document.querySelector('+json.dumps(selector)+').value')==value
    finally:cdp('Runtime.releaseObject',objectId=r['objectId'])


new_tab(origin+'/#usage');wait("!!document.querySelector('input[name=email]')",'login prerequisite')
fill('input[name=email]',control['email']);fill('input[name=password]',control['password']);click('button','登录')
wait("document.querySelector('h1')?.textContent==='用量明细'&&document.querySelector('.pagination>span')?.textContent==='共 2 条'",'real usage loaded')
receipts=[]
for index,(route,label,query,count,columns) in enumerate([
    ('usage','用量明细',control['modelId'],2,['id','user_id','department_id','application','model_id','period','amount','reserved','status','input_tokens','output_tokens','created_at']),
    ('traces','调用追踪',control['modelId'],2,['id','user_id','application','model_id','status','input_tokens','output_tokens','duration_ms','error_code','created_at']),
    ('client-events','终端事件','configuration.applied',1,['id','user_id','type','created_at']),
    ('audit','操作日志','vault.create',1,['id','user_id','action','target','created_at']),
    ('usage','用量明细','owned-no-such-model',0,['id','user_id','department_id','application','model_id','period','amount','reserved','status','input_tokens','output_tokens','created_at']),
]):
    click('link',label)
    wait("document.querySelector('h1')?.textContent==="+json.dumps(label)+"&&document.querySelector('.table-scroll')?.getAttribute('aria-busy')==='false'",'loaded '+route)
    fill('input[aria-label=搜索]',str(query));click('button','查询')
    wait("document.querySelector('.pagination>span')?.textContent==="+json.dumps('共 '+str(count)+' 条')+"&&document.querySelector('.table-scroll')?.getAttribute('aria-busy')==='false'",'filtered '+route)
    href=js("Array.from(document.querySelectorAll('a')).find(a=>a.textContent.trim()==='导出').href")
    url=urlparse(href);assert url.scheme+'://'+url.netloc==origin and url.path.endswith('/'+route)
    assert parse_qs(url.query)=={'format':['csv'],'q':[str(query)]}
    folder=control_path.parent/'downloads'/str(index);folder.mkdir(parents=True,mode=0o700)
    cdp('Browser.setDownloadBehavior',behavior='allow',downloadPath=str(folder))
    click('link','导出')
    deadline=time.monotonic()+20;files=[]
    while time.monotonic()<deadline:
        files=list(folder.glob('*.csv'))
        if len(files)==1 and not list(folder.glob('*.crdownload')):break
        time.sleep(.1)
    assert len(files)==1 and files[0].name==route+'.csv','actual completed browser download required'
    raw=files[0].read_bytes();reader=csv.DictReader(io.StringIO(raw.decode('utf-8-sig')));rows=list(reader)
    assert reader.fieldnames==columns and len(rows)==count
    assert all(r['user_id']==control['userId'] for r in rows)
    if route in ('usage','traces'):
        assert all(r['model_id']==control['modelId'] and r['application']=='uwork' and r['input_tokens']=='12' and r['output_tokens']=='2' for r in rows)
        assert all(r['status']==('settled' if route=='usage' else 'succeeded') for r in rows)
        if route=='usage':assert sum(int(r['amount']) for r in rows)==14*count
    elif route=='client-events':assert rows[0]['type']=='configuration.applied'
    else:assert rows[0]['action']=='vault.create'
    receipts.append(dict(route=route,rows=count,columns=columns,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest()))
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(dict(stage='export-all',downloads=receipts)))
