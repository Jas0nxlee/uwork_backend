"""Original file-summary Undo: preview cancellation, late conflict and explicit safe retry."""
import json


def run_file_only_case(*,bridge,click,until,proof,canonical,scroll,owned,warm,before,sid,evidence,result,initial,after,external):
    undo='button[title="撤销"]'
    def preview():
        until('(()=>({ok:!!document.querySelector('+json.dumps(undo)+')&&!document.querySelector('+json.dumps(undo)+').disabled}))()','original standalone Undo enabled')
        scroll(undo);click(undo,'original file-summary preview')
        until("(()=>{const d=document.querySelector('[role=dialog]'),b=d?.querySelector('[data-slot=dialog-footer] button');return{ok:!!d&&d.innerText.includes('owned-rewind.txt')&&!!b&&!b.disabled}})()",'real safe standalone preview')
    def preserve(stage):
        assert proof('file-only-'+stage)==warm
        r=canonical(sid,'file-only-'+stage)
        original=[(m['role'],m['text']) for m in before['semantic']['active'] if m['text']]
        active=[(m['role'],m['text']) for m in r['semantic']['active'] if m['text']]
        assert active[:len(original)]==original,'file-only command cannot reset original conversation'
        assert set(before['physicalMessageIds']).issubset(r['physicalMessageIds'])
    preview();assert owned.read_text()==after
    click('[role=dialog] button[data-slot=dialog-close]','close original safe file preview')
    until("(()=>({ok:!document.querySelector('[role=dialog]')}))()",'preview closed')
    preserve('preview-cancel');assert owned.read_text()==after
    preview();owned.write_text(external)
    click('[role=dialog] [data-slot=dialog-footer] button','original file-only apply after late external edit')
    state=until("(()=>{const d=document.querySelector('[role=dialog]'),b=d?.querySelector('[data-slot=dialog-footer] button');return{ok:!d||d.innerText.includes('当前文件已被外部修改'),dialogVisible:!!d,text:d?.innerText,confirmDisabled:b?.disabled}})()",'late apply outcome delivered')
    (evidence/'file-only-late-conflict-ui.json').write_text(json.dumps(state,ensure_ascii=False,indent=2))
    assert owned.read_text()==external
    preserve('late-conflict')
    assert state['dialogVisible'] and state['confirmDisabled'] is True and 'owned-rewind.txt' in state['text'],'failed file apply must retain latest unsafe preview, not close as accepted success'
    click('[role=dialog] button[data-slot=dialog-close]','close explicit standalone failure')
    until("(()=>({ok:!document.querySelector('[role=dialog]')}))()",'failed preview closed')
    owned.write_text(after)
    preview();click('[role=dialog] [data-slot=dialog-footer] button','explicit standalone safe file apply')
    until("(()=>({ok:!document.querySelector('[role=dialog]')&&document.body.innerText.includes('已撤销')&&document.querySelector('button[title=撤销]')?.disabled===true}))()",'original file summary reverted')
    assert owned.read_text()==initial;preserve('safe-apply')
    bridge.raw_cdp('Page.reload')
    until("(()=>({ok:document.body.innerText.includes('PREPUBLISH_REWIND_ANSWER_A')&&document.body.innerText.includes('已撤销')}))()",'standalone file rewind persists after reload')
    assert owned.read_text()==initial;preserve('reloaded')
    result['checks'].append('standalone-file-undo-cancel-late-conflict-visible-failure-safe-retry-and-reload-zero-inference')
    result['fileOnlyRewind']=dict(sessionId=sid,currentSettled=4,currentCredits=88,lateConflictPreserved=True,conversationPreserved=True)
