import time, json, base64, pathlib, uuid

out = pathlib.Path(EVIDENCE)
results = []

def facts():
    return json.loads(js("document.querySelector('[data-testid=fixture-facts]')?.textContent || '{}'") or '{}')

def wait(expression):
    for _ in range(160):
        if js(expression): return
        time.sleep(.025)
    raise AssertionError(expression + ': ' + str(js('document.body.innerText')))

def click(label, role='button'):
    nodes = cdp('Accessibility.getFullAXTree')['nodes']
    matches = [n for n in nodes if n.get('role', {}).get('value') == role and n.get('name', {}).get('value') == label]
    assert len(matches) == 1, (label, [(n.get('role',{}).get('value'), n.get('name',{}).get('value')) for n in nodes if not n.get('ignored')])
    q = cdp('DOM.getBoxModel', backendNodeId=matches[0]['backendDOMNodeId'])['model']['content']
    click_at_xy(sum(q[0::2])/4, sum(q[1::2])/4)

def alert():
    return bool(js("!!document.querySelector('[data-testid=enterprise-login-card] [role=alert]')"))

def login():
    wait("!!document.querySelector('[data-testid=enterprise-wecom-login]:not(:disabled)')")
    label = js("document.querySelector('[data-testid=enterprise-wecom-login]').innerText")
    click(label)

def snapshot(name):
    (out/(name+'.txt')).write_text(js('document.body.innerText'))
    (out/(name+'-facts.json')).write_text(json.dumps(facts(), ensure_ascii=False, indent=2))
    (out/(name+'-ax.json')).write_text(json.dumps(cdp('Accessibility.getFullAXTree'), ensure_ascii=False))
    (out/(name+'.png')).write_bytes(base64.b64decode(cdp('Page.captureScreenshot')['data']))

for case in CASES.split(','):
    channel = uuid.uuid4().hex
    primary = new_tab(ORIGIN+'/?case='+case+'&channel='+channel)
    wait_for_load()
    wait("!!document.querySelector('[data-org-id=a][aria-checked=true]')")
    controller = new_tab(ORIGIN+'/?case='+case+'&channel='+channel+'&controller=1')
    wait_for_load()
    switch_tab(primary)
    def command(name):
        before = facts()['controllerAcks']
        switch_tab(controller)
        click(name)
        switch_tab(primary)
        wait("Number(JSON.parse(document.querySelector('[data-testid=fixture-facts]').textContent).controllerAcks)>"+str(before))
    try:
        snapshot(case+'-before')
        if case in ['reopen', 'select', 'no-id-repeat']:
            login()
            wait("!!document.querySelector('[role=alert]')")
            assert facts()['A']['view']['error'] == 'failed'
            if case == 'select': click('公司 B', 'radio')
            else:
                click('跳过登录，继续使用')
                wait("!document.querySelector('[data-testid=enterprise-login-page]')")
                click('打开登录')
            wait("!!document.querySelector('[data-testid=enterprise-wecom-login]')")
            snapshot(case+'-cleared')
            assert not alert(), 'old Host failed diagnostic revived after explicit clear'
            assert facts()['A']['view']['error'] == 'failed', 'fixture must retain Host diagnostic'
            command('republish-failed')
            assert not alert(), 'same failed republish revived old diagnostic'
            if case == 'no-id-repeat':
                login(); wait("!!document.querySelector('[role=alert]')")
                assert facts()['A']['starts'] == 2
        elif case == 'select-fail':
            click('公司 B', 'radio')
            wait("!!document.querySelector('[role=alert]')")
            assert facts()['A']['view']['selectedOrgId'] == 'a'
            command('allow-selection'); click('公司 B', 'radio')
            wait("!!document.querySelector('[data-org-id=b][aria-checked=true]')")
            assert not alert()
        elif case in ['poll-event', 'poll-result', 'complete-event', 'complete-result', 'late-id']:
            login()
            wait("JSON.parse(document.querySelector('[data-testid=fixture-facts]').textContent).A.starts===1")
            if case == 'late-id':
                command('fail-view'); command('republish-failed'); command('old-snapshot')
                assert not alert(), 'no actual begin ID yet; do not guess attribution'
                command('release-start')
            else:
                wait("JSON.parse(document.querySelector('[data-testid=fixture-facts]').textContent).opened.length===1")
                if case.startswith('complete'):
                    command('callback')
                    wait("JSON.parse(document.querySelector('[data-testid=fixture-facts]').textContent).completePending")
                command('fail-view' if case.endswith('event') else ('release-poll' if case.startswith('poll') else 'release-complete'))
            wait("!!document.querySelector('[role=alert]')")
            if case == 'late-id': assert facts()['opened'] == [], 'known failed ID opened a stale native surface'
            if case.endswith('event'): assert facts()['completePending' if case.startswith('complete') else 'pollPending']
        elif case.startswith('old-start'):
            login(); wait("JSON.parse(document.querySelector('[data-testid=fixture-facts]').textContent).A.starts===1")
            click('重新选择公司'); click('公司 B', 'radio'); login()
            time.sleep(.1)
            assert facts()['A']['starts'] == 1, 'same owner start must wait for old cancellation'
            command('release-start')
            wait("JSON.parse(document.querySelector('[data-testid=fixture-facts]').textContent).A.starts===2")
            wait("JSON.parse(document.querySelector('[data-testid=fixture-facts]').textContent).opened.length===1")
            assert not alert()
            assert 'A-2' not in facts()['A']['cancelled']
            if case.endswith('success'): assert 'A-1' in facts()['A']['cancelled']
        elif case.startswith('old-select'):
            click('公司 B', 'radio')
            wait("JSON.parse(document.querySelector('[data-testid=fixture-facts]').textContent).A.selects===1")
            if case.endswith('success'):
                login(); wait("!!document.querySelector('[role=alert]')")
                command('release-selection')
                wait("JSON.parse(document.querySelector('[data-testid=fixture-facts]').textContent).A.view.selectedOrgId==='b'")
                assert alert(), 'old selection success cleared current start failure'
            else:
                click('跳过登录，继续使用'); click('打开登录'); command('reject-selection')
                assert not alert(), 'old selection rejection revived hint'
        elif case in ['owner-barrier-hold', 'owner-barrier-reject', 'owner-direct']:
            login(); wait("JSON.parse(document.querySelector('[data-testid=fixture-facts]').textContent).A.starts===1")
            if case != 'owner-direct': click('重新选择公司')
            command('owner-b')
            wait("JSON.parse(document.querySelector('[data-testid=fixture-facts]').textContent).owner==='B'")
            login()
            wait("JSON.parse(document.querySelector('[data-testid=fixture-facts]').textContent).B.starts===1")
            assert alert(), 'B current failure must remain visible'
            command('release-start')
            wait("JSON.parse(document.querySelector('[data-testid=fixture-facts]').textContent).A.cancelled.includes('A-1')")
            if case.endswith('reject'): command('reject-cancel')
            assert facts()['B']['cancelled'] == [], 'new owner must not cancel old owner ID'
            assert alert()
        elif case == 'owner-selection':
            click('公司 B', 'radio'); command('owner-b')
            wait("JSON.parse(document.querySelector('[data-testid=fixture-facts]').textContent).owner==='B'")
            assert not alert()
            login(); wait("!!document.querySelector('[role=alert]')")
            command('release-selection')
            assert alert(), 'old owner selection success cleared B failure'
        elif case in ['old-poll-clear', 'old-poll-current']:
            login(); wait("JSON.parse(document.querySelector('[data-testid=fixture-facts]').textContent).opened.length===1")
            click('重新选择公司')
            wait("!!document.querySelector('[data-testid=enterprise-wecom-login]')")
            if case == 'old-poll-current':
                login(); wait("!!document.querySelector('[role=alert]')")
            command('reject-poll')
            assert alert() == (case == 'old-poll-current'), 'old poll changed current presentation'
        elif case == 'owner-active':
            login(); wait("JSON.parse(document.querySelector('[data-testid=fixture-facts]').textContent).opened.length===1")
            command('owner-b')
            wait("JSON.parse(document.querySelector('[data-testid=fixture-facts]').textContent).A.cancelled.includes('A-1')")
            click('跳过登录，继续使用'); click('打开登录')
            assert not alert()
            login(); wait("!!document.querySelector('[role=alert]')")
            assert facts()['B']['cancelled'] == [], 'B skip must not cancel A active ID'
        elif case == 'owner-logout':
            command('authenticate')
            wait("!document.querySelector('[data-testid=enterprise-login-page]')")
            click('退出合成会话'); command('owner-b')
            click('打开登录'); click('跳过登录，继续使用')
            command('reject-logout')
            assert not js("!!document.querySelector('[data-testid=enterprise-login-page]')"), 'old owner logout reopened B window'
            click('打开登录'); assert not alert()
        elif case == 'same-owner-barrier-reject':
            login(); wait("JSON.parse(document.querySelector('[data-testid=fixture-facts]').textContent).A.starts===1")
            click('重新选择公司'); login(); command('release-start')
            wait("JSON.parse(document.querySelector('[data-testid=fixture-facts]').textContent).A.cancelled.includes('A-1')")
            command('reject-cancel')
            wait("!!document.querySelector('[role=alert]')")
            assert facts()['A']['starts'] == 1, 'failed cancellation barrier must not admit another begin'
        elif case == 'auth-late-id':
            login(); command('authenticate')
            wait("!document.querySelector('[data-testid=enterprise-login-page]')")
            command('release-start'); time.sleep(.1)
            assert facts()['A']['view']['status'] == 'authenticated'
            assert facts()['opened'] == [] and facts()['A']['cancelled'] == []
        else: raise AssertionError('unknown finite case '+case)
        assert facts()['runtimeErrors'] == 0, facts()
        assert facts()['externalOpens'] == 0, 'no actual external auth navigation allowed'
        assert facts()['A']['reads'] == 0 and facts()['B']['reads'] == 0, 'no additional getView before begin'
        snapshot(case+'-after')
        results.append({'case':case, 'status':'PASS'})
    except Exception as error:
        snapshot(case+'-failed')
        results.append({'case':case, 'status':'FAIL', 'error':str(error)})
    finally:
        cdp('Target.closeTarget', targetId=primary)
        cdp('Target.closeTarget', targetId=controller)
(out/'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
print(json.dumps(results, ensure_ascii=False))
assert all(result['status']=='PASS' for result in results), 'enterprise login error presentation regression'
