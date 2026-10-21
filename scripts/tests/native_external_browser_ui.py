"""Exercise the original external-browser menu and observe only the owned native tab title."""
import json
from pathlib import Path
import subprocess
import time
from owned_external_page import OwnedExternalPage
from owned_chrome_tab_witness import inspect_owned_tab


def default_browser():
    code = '''import AppKit; import Foundation
let url=NSWorkspace.shared.urlForApplication(toOpen:URL(string:"http://127.0.0.1")!)!
let bundle=Bundle(url:url)!, id=bundle.bundleIdentifier!
let result:[String:Any]=["id":id,"version":bundle.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown","pids":NSRunningApplication.runningApplications(withBundleIdentifier:id).filter{!$0.isTerminated}.map{Int($0.processIdentifier)}]
print(String(data:try! JSONSerialization.data(withJSONObject:result),encoding:.utf8)!)'''
    result = subprocess.run(['xcrun', 'swift', '-e', code], capture_output=True, text=True, timeout=15, check=True)
    value = json.loads(result.stdout)
    assert value['id'] == 'com.google.Chrome', 'Only the preflighted default Chrome is supported'
    return value


def tabs(browser, title):
    values = [inspect_owned_tab(pid, title) for pid in browser['pids']]
    return {'complete': bool(values) and all(v['complete'] for v in values),
            'tabMatches': sum(v['tabMatches'] for v in values),
            'windowMatches': sum(v['windowMatches'] for v in values),
            'processes': values}


def run_external_browser(bridge, click, until, evidence):
    preflight = json.loads((Path(__file__).resolve().parents[2] / 'evidence/client-external-page-preflight-v6-20261020/preflight-result.json').read_text())
    assert preflight['status'] == 'passed' and not preflight['usesPersonalProfile']
    browser = default_browser()
    major = int(browser['version'].split('.')[0])
    assert major == preflight['chromeMajor'], 'Installed browser changed after the close preflight'
    page = OwnedExternalPage(evidence)
    facts = {'defaultBrowser': browser, 'personalBrowserProfileAttached': False}
    try:
        before = tabs(browser, page.title)
        facts['beforeOpen'] = before
        assert before['complete'] and before['tabMatches'] == 0, 'Exact owned title must be absent before open'
        click('[data-testid="conversation-share-open-browser"]', 'open-original-share-in-embedded-browser')
        until('''(()=>({ok:!!document.querySelector('[data-testid="browser-address-input"]')}))()''', 'Original browser address bar not ready')
        click('[data-testid="browser-address-input"]', 'focus-original-browser-address')
        address_state = '''(()=>{const e=document.querySelector('[data-testid="browser-address-input"]');return{ok:document.activeElement===e,focused:document.activeElement===e,length:e?.value.length,start:e?.selectionStart,end:e?.selectionEnd,containsOwned:e?.value.includes(%s),equalsOwned:e?.value===%s}})()''' % (json.dumps(page.url), json.dumps(page.url))
        facts['addressBeforeSelect'] = until(address_state, 'Original address input did not receive focus')
        for kind in ('keyDown', 'keyUp'):
            bridge.raw_cdp('Input.dispatchKeyEvent', type=kind, key='a', code='KeyA', modifiers=4, windowsVirtualKeyCode=65)
        facts['addressAfterShortcut'] = bridge.evaluate(address_state)
        state = facts['addressAfterShortcut']
        if state['start'] != 0 or state['end'] != state['length']:
            # CDP 的 Meta+A 不保证触发 macOS 原生编辑命令；显式发送同一 selectAll 编辑命令。
            bridge.raw_cdp('Input.dispatchKeyEvent', type='keyDown', key='a', code='KeyA', modifiers=4, windowsVirtualKeyCode=65, commands=['selectAll'])
            bridge.raw_cdp('Input.dispatchKeyEvent', type='keyUp', key='a', code='KeyA', modifiers=4, windowsVirtualKeyCode=65)
        facts['addressSelected'] = bridge.evaluate(address_state)
        assert facts['addressSelected']['start'] == 0 and facts['addressSelected']['end'] == facts['addressSelected']['length'], 'Original address was not fully selected'
        bridge.raw_cdp('Input.insertText', text=page.url)
        facts['addressAfterInput'] = bridge.evaluate(address_state)
        assert facts['addressAfterInput']['equalsOwned'], 'Owned address was not entered'
        bridge.raw_cdp('Input.dispatchKeyEvent', type='keyDown', key='Enter', code='Enter', windowsVirtualKeyCode=13, text='\r')
        bridge.raw_cdp('Input.dispatchKeyEvent', type='keyUp', key='Enter', code='Enter', windowsVirtualKeyCode=13)
        embedded = page.wait('embedded', 'ready')
        assert embedded['serverAgent']['electron'], 'Initial navigation must be the original Electron guest'
        facts['embeddedReceipt'] = embedded
        current = default_browser()
        assert current['id'] == browser['id'] and current['version'] == browser['version']
        page.arm_external()
        click('[data-testid="browser-more-button"]', 'open-original-browser-more-menu')
        until('''(()=>{const e=document.querySelector('[data-testid="browser-open-external-item"]');return{ok:!!e&&e.getAttribute('aria-disabled')!=='true'}})()''', 'Default browser menu item unavailable')
        click('[data-testid="browser-open-external-item"]', 'open-default-browser-once')
        page.wait('external', 'ready')
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            visible = tabs(current, page.title)
            if visible['complete'] and visible['tabMatches'] == 1:
                break
            time.sleep(.1)
        facts['openedTab'] = visible
        assert visible['complete'] and visible['tabMatches'] == 1, 'Exactly one owned native Chrome tab must appear'
        facts.update(page.verify_external(major))
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            after = tabs(current, page.title)
            if after['complete'] and after['tabMatches'] == 0 and after['windowMatches'] == 0:
                break
            time.sleep(.1)
        facts['afterSelfClose'] = after
        assert after['complete'] and after['tabMatches'] == 0 and after['windowMatches'] == 0, 'Owned external tab did not disappear'
        assert default_browser()['id'] == browser['id'], 'Default browser setting changed unexpectedly'
        facts['status'] = 'passed'
        return facts
    finally:
        page.close()
        (Path(evidence) / 'default-browser-proof.json').write_text(json.dumps(facts, indent=2) + '\n')
