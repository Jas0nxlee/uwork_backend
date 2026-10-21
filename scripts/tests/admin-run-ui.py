"""Original admin agent execution and run cancellation controls; read-only DOM."""
import json
import os
from pathlib import Path
import time
from urllib.parse import urlparse

control = json.loads(Path(os.environ['UWORK_ADMIN_RUN_CONTROL']).read_text())
stage = os.environ['UWORK_EXPERIENCE_STAGE']
origin = control['origin']
assert urlparse(origin).hostname == '127.0.0.1' and urlparse(origin).port != 3000


def wait(expression, label):
    end = time.monotonic()+20
    while time.monotonic()<end:
        if js(expression):
            return
        time.sleep(.1)
    raise AssertionError('Original admin UI condition: '+label)


def click(role, name):
    nodes = cdp('Accessibility.getFullAXTree')['nodes']
    nodes = [n for n in nodes if not n.get('ignored') and n.get('role', {}).get('value')==role and n.get('name', {}).get('value')==name]
    assert len(nodes)==1, 'unique owned original control required'
    node = nodes[0]['backendDOMNodeId']
    cdp('DOM.scrollIntoViewIfNeeded', backendNodeId=node)
    q = cdp('DOM.getBoxModel', backendNodeId=node)['model']['content']
    click_at_xy(sum(q[0::2])/4, sum(q[1::2])/4)


def fill(selector, value, replace=False):
    remote = cdp('Runtime.evaluate', expression='document.querySelector('+json.dumps(selector)+')', returnByValue=False)['result']
    assert remote.get('objectId')
    try:
        cdp('DOM.getDocument', depth=0)
        node = cdp('DOM.requestNode', objectId=remote['objectId'])['nodeId']
        cdp('DOM.focus', nodeId=node)
        if replace:
            cdp('Input.dispatchKeyEvent',type='keyDown',key='a',code='KeyA',modifiers=4,windowsVirtualKeyCode=65,commands=['selectAll'])
            cdp('Input.dispatchKeyEvent',type='keyUp',key='a',code='KeyA',modifiers=4,windowsVirtualKeyCode=65)
        cdp('Input.insertText', text=value)
    finally:
        cdp('Runtime.releaseObject', objectId=remote['objectId'])


def submit(marker):
    click('link', '企业智能体')
    wait("document.querySelector('tbody')?.innerText.includes('Owned admin execution')", 'published agent row')
    click('button', '执行')
    wait("!!document.querySelector('dialog[open] textarea')", 'original execution form')
    fill('dialog[open] textarea', marker)
    click('button', '保存')
    wait("!document.querySelector('dialog[open]')&&document.body.innerText.includes('任务已进入队列')", 'execution submission accepted')


def row_expression(run_id):
    return "[...document.querySelectorAll('tbody tr')].find(e=>e.innerText.includes("+json.dumps(run_id)+"))"


def login(view):
    new_tab(origin+'/#'+view)
    wait("!!document.querySelector('input[name=email]')", 'login prerequisite')
    fill('input[name=email]', control['email'])
    fill('input[name=password]', control['password'])
    click('button', '登录')
    wait("!!document.querySelector('nav')", 'authenticated navigation')


facts = dict(stage=stage)
if stage=='launch-success':
    login('agents')
    submit('OWNED_ADMIN_SUCCESS')
    facts['originalExecuteForm']=True
elif stage=='success-detail':
    click('link', '执行任务')
    wait(row_expression(control['successId'])+"?.innerText.includes('succeeded')", 'successful run row')
    click('button', '详情')
    wait("!!document.querySelector('pre.detail')", 'original decrypted result detail')
    expected=json.dumps({'id':control['successId'],'tenant':control['tenantId'],'user':control['userId']})
    value=js("(()=>{const e="+expected+",d=JSON.parse(document.querySelector('pre.detail').textContent);return {idMatches:d.id===e.id,tenantMatches:d.tenant_id===e.tenant,userMatches:d.user_id===e.user,success:d.status==='succeeded',outputMatches:d.output==='OWNED_ADMIN_RESULT',inputMatches:d.input==='OWNED_ADMIN_SUCCESS',emptyTools:Array.isArray(d.tools)&&d.tools.length===0}})()")
    assert all(value.values())
    facts.update(value)
    click('button', '关闭')
elif stage=='launch-held':
    submit('OWNED_ADMIN_HOLD')
    facts['originalExecuteForm']=True
elif stage=='cancel-held':
    click('link', '执行任务')
    wait(row_expression(control['heldId'])+"?.innerText.includes('running')", 'in-flight owned run row')
    click('button', '取消执行')
    wait(row_expression(control['heldId'])+"?.innerText.includes('cancelled')", 'original cancellation terminal row')
    assert not js("!!document.querySelector('button[aria-label=取消执行]')")
    facts['originalCancellationTerminal']=True
elif stage=='cancel-detail-reload':
    row=row_expression(control['heldId'])
    point=js("(()=>{const e=("+row+").querySelector('button[aria-label=详情]'),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()")
    click_at_xy(point['x'],point['y'])
    wait("!!document.querySelector('pre.detail')", 'cancelled original detail')
    value=js("(()=>{const d=JSON.parse(document.querySelector('pre.detail').textContent);return{cancelled:d.status==='cancelled',codeMatches:d.error_code==='CANCELLED',noOutput:d.output===null,inputMatches:d.input==='OWNED_ADMIN_HOLD',emptyTools:Array.isArray(d.tools)&&d.tools.length===0}})()")
    assert all(value.values())
    facts.update(value)
    click('button', '关闭')
    cdp('Page.reload')
    wait("document.querySelectorAll('tbody tr').length===2&&"+row_expression(control['successId'])+"?.innerText.includes('succeeded')&&"+row_expression(control['heldId'])+"?.innerText.includes('cancelled')", 'two terminal runs after reload')
    facts['reloadTerminals']=True
elif stage=='create-dataset':
    login('datasets')
    wait("document.querySelector('h1')?.textContent==='评测数据集'", 'dataset original view')
    click('button','新建')
    wait("!!document.querySelector('dialog[open] textarea')", 'dataset JSON form')
    fill('dialog[open] input','Owned evaluation dataset')
    cases=[dict(input='OWNED_EVAL_FIRST',expected='OWNED_ADMIN_RESULT',match='exact'),dict(input='OWNED_EVAL_SECOND',expected='OWNED_ADMIN_RESULT',match='exact')]
    text=json.dumps(cases)
    fill('dialog[open] textarea',text,replace=True)
    assert js("document.querySelector('dialog[open] textarea').value")==text
    click('button','保存')
    wait("!document.querySelector('dialog[open]')&&document.querySelector('tbody')?.innerText.includes('Owned evaluation dataset')", 'original dataset created')
    facts['createdTwoSamplesViaOriginalForm']=True
elif stage=='create-evaluation':
    click('link','评测报告')
    wait("document.querySelector('h1')?.textContent==='评测报告'", 'evaluation original view')
    click('button','新建')
    wait("document.querySelectorAll('dialog[open] input').length===2", 'original evaluation form')
    fill('dialog[open] .form-grid > label:nth-child(1) input',control['agentId'])
    fill('dialog[open] .form-grid > label:nth-child(2) input',control['datasetId'])
    click('button','保存')
    wait("!document.querySelector('dialog[open]')&&document.querySelectorAll('tbody tr').length===1", 'original evaluation accepted')
    facts['originalEvaluationSubmitted']=True
elif stage=='evaluation-cancel':
    row=row_expression(control['evaluationId'])
    wait(row+"?.innerText.includes('running')", 'running original evaluation row')
    click('button','取消执行')
    wait(row+"?.innerText.includes('cancelled')", 'evaluation cancellation terminal row')
    click('button','详情')
    wait("!!document.querySelector('pre.detail')", 'cancelled evaluation detail')
    details=js("(()=>{const d=JSON.parse(document.querySelector('pre.detail').textContent);return{cancelled:d.status==='cancelled',idMatches:d.id==="+json.dumps(control['evaluationId'])+",caseCount:d.report.cases.length,noSyntheticScore:d.report.passRate===undefined}})()")
    assert details==dict(cancelled=True,idMatches=True,caseCount=2,noSyntheticScore=True)
    facts.update(details)
    click('button','关闭')
    cdp('Page.reload')
    wait(row+"?.innerText.includes('cancelled')&&!document.querySelector('button[aria-label=取消执行]')", 'cancelled evaluation survives reload')
    facts['reloadedCancelled']=True
elif stage=='evaluation-detail':
    click('button','刷新')
    row=row_expression(control['evaluationId'])
    wait(row+"?.innerText.includes('succeeded')", 'original score table')
    cells=js("[...("+row+").querySelectorAll('td')].slice(0,4).map(e=>e.textContent.trim())")
    assert cells==[control['evaluationId'],'succeeded','1','2']
    click('button','详情')
    wait("!!document.querySelector('pre.detail')", 'decrypted evaluation report')
    value=js("(()=>{const d=JSON.parse(document.querySelector('pre.detail').textContent),r=d.report;return{idMatches:d.id==="+json.dumps(control['evaluationId'])+",succeeded:d.status==='succeeded',total:r.total,passed:r.passed,rate:r.passRate,caseCount:r.cases.length,casesSucceeded:r.cases.every(c=>c.passed===true&&c.status==='succeeded')}})()")
    assert value==dict(idMatches=True,succeeded=True,total=2,passed=2,rate=1,caseCount=2,casesSucceeded=True)
    facts.update(value)
    click('button','关闭')
    cdp('Page.reload')
    wait(row+"?.innerText.includes('succeeded')", 'evaluation survives reload')
    facts['reloadedScore']=True
elif stage=='audit-consumer':
    click('link', '操作日志')
    wait("document.querySelector('h1')?.textContent==='操作日志'&&!!document.querySelector('a[href=\"#audit\"][aria-current=page]')&&!!document.querySelector('input[aria-label=搜索]')", 'original audit view and search')
    fill('input[aria-label=搜索]', 'runtime')
    wait("document.querySelector('input[aria-label=搜索]')?.value==='runtime'", 'audit query exact readback')
    click('button', '查询')
    try:
        wait("document.querySelectorAll('tbody tr').length===3&&[...document.querySelectorAll('tbody tr')].every(e=>e.innerText.includes('runtime.'))", 'runtime audit filtered rows')
    except AssertionError:
        print('OWNED_AUDIT_DIAGNOSTIC='+json.dumps(js("(()=>({query:document.querySelector('input[aria-label=搜索]')?.value,rowCount:document.querySelectorAll('tbody tr').length,actions:[...document.querySelectorAll('tbody tr')].map(e=>e.querySelector('td')?.textContent) }))()")))
        raise
    rows=js("[...document.querySelectorAll('tbody tr')].map(e=>[...e.querySelectorAll('td')].slice(0,3).map(c=>c.textContent.trim()))")
    assert sorted(rows)==sorted([['runtime.enqueue',control['userId'],control['successId']],['runtime.enqueue',control['userId'],control['heldId']],['runtime.cancel',control['userId'],control['heldId']]])
    facts['matchedRuntimeAuditRows']=3
else:
    raise AssertionError('unsupported stage')
print('ADMIN_EXPERIENCE_RESULT='+json.dumps(facts))
