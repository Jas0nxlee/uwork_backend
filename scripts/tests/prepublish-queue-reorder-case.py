"""Original queue drag handle plus reload; actual execution order is checked by caller."""
import json


def run_queue_reorder_case(*, bridge, click, until, proof, queued, result, budget):
    click('[contenteditable="true"]', 'compose queued E')
    bridge.raw_cdp('Input.insertText', text='PREPUBLISH_QUEUE_E')
    click('[data-testid="v4-composer-send"]', 'enqueue E after D')
    expression = '''(()=>{const a=[...document.querySelectorAll('li[data-queue-item-id]')];return{ok:a.length===2,items:a.map(e=>({id:e.dataset.queueItemId,text:e.innerText}))}})()'''
    state = until(expression, 'two original queued rows')
    assert 'PREPUBLISH_QUEUE_EDITED_D' in state['items'][0]['text']
    assert 'PREPUBLISH_QUEUE_E' in state['items'][1]['text']
    first, last = state['items']
    def box(selector):
        return until('''(()=>{const e=document.querySelector(%s),r=e?.getBoundingClientRect();return{ok:!!r&&!e.disabled&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),x:r?.x+r.width/2,y:r?.y+r.height/2}})()''' % json.dumps(selector), 'owned drag control')
    source = box('[data-v4-queue-drag-handle][data-queue-item-id="' + last['id'] + '"]')
    target = box('li[data-queue-item-id="' + first['id'] + '"]')
    bridge.raw_cdp('Input.dispatchMouseEvent', type='mouseMoved', x=source['x'], y=source['y'])
    bridge.raw_cdp('Input.dispatchMouseEvent', type='mousePressed', x=source['x'], y=source['y'], button='left', buttons=1, clickCount=1)
    for step in range(1, 9):
        budget()
        bridge.raw_cdp('Input.dispatchMouseEvent', type='mouseMoved', x=source['x'],
                       y=source['y']+(target['y']-source['y'])*step/8, buttons=1)
    bridge.raw_cdp('Input.dispatchMouseEvent', type='mouseReleased', x=source['x'], y=target['y'], button='left', clickCount=1)
    order = '''(()=>{const a=[...document.querySelectorAll('li[data-queue-item-id]')];return{ok:a.length===2&&a[0].innerText.includes('PREPUBLISH_QUEUE_E')&&a[1].innerText.includes('PREPUBLISH_QUEUE_EDITED_D')}})()'''
    until(order, 'E before D after physical drag')
    assert proof('queue-reordered') == queued
    bridge.raw_cdp('Page.reload')
    until(order, 'authoritative reordered queue after reload')
    assert proof('queue-reordered-reload') == queued
    result['checks'].append('original-physical-queue-drag-order-survives-reload')
