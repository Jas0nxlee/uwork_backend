"""Original queue edit admission, draft conflict and requeue via physical CDP input."""
import json


def run_queue_edit_case(*, bridge, click, until, proof, queued, result, budget):
    composer = '[contenteditable="true"]'
    edit = '[data-testid^="v4-queue-item-edit-"]'
    rows = '[data-testid^="v4-queue-item-"][data-queue-item-id]'
    original = 'PREPUBLISH_QUEUE_C'
    changed = 'PREPUBLISH_QUEUE_EDITED_D'
    draft = 'PREPUBLISH_DRAFT_KEEP'

    def content(text):
        return 'document.querySelector(' + json.dumps(composer) + ')?.innerText.trim()===' + json.dumps(text)

    def replace(text):
        click(composer, 'focus queue draft')
        for kind in ['keyDown', 'keyUp']:
            budget()
            bridge.raw_cdp('Input.dispatchKeyEvent', type=kind, key='a', code='KeyA',
                           modifiers=4, windowsVirtualKeyCode=65,
                           **({'commands': ['selectAll']} if kind == 'keyDown' else {}))
        for kind in ['keyDown', 'keyUp']:
            bridge.raw_cdp('Input.dispatchKeyEvent', type=kind, key='Backspace', code='Backspace', windowsVirtualKeyCode=8)
        if text:
            bridge.raw_cdp('Input.insertText', text=text)
        until('(()=>({ok:' + content(text) + '}))()', 'queue draft exact value')

    replace(draft)
    click(edit, 'edit queued C with conflicting draft')
    until('(()=>({ok:document.body.innerText.includes("请先发送或清空当前草稿，再编辑队列消息。")||document.body.innerText.includes("Send or clear the current draft before editing a queued message.")}))()', 'original draft conflict notification')
    until('(()=>({ok:' + content(draft) + '&&document.querySelector(' + json.dumps(rows) + ')?.innerText.includes(' + json.dumps(original) + ')}))()', 'draft conflict preserves queue and draft')
    assert proof('queue-edit-conflict') == queued
    replace('')
    click(edit, 'withdraw queued C into original composer')
    until('(()=>({ok:!document.querySelector(' + json.dumps(rows) + ')&&' + content(original) + '}))()', 'authoritative queue withdrawal and composer restore')
    assert proof('queue-edit-restored') == queued
    replace(changed)
    click('[data-testid="v4-composer-send"]', 'requeue edited D')
    until('(()=>({ok:document.querySelector(' + json.dumps(rows) + ')?.innerText.includes(' + json.dumps(changed) + ')&&' + content('') + '}))()', 'edited D queued')
    assert proof('queue-edit-requeued') == queued
    result['checks'].append('original-queue-edit-draft-conflict-withdraw-restore-and-requeue')
    return changed
