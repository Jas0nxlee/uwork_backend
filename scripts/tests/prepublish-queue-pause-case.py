"""Original stop and resume controls; persisted pause and conservative interruption charge."""
import json


def run_queue_pause_case(*, bridge, click, until, proof, queued, member, result):
    original = [row for row in queued['ledger'] if row['user_id'] == member]
    assert len(original) == 1 and original[0]['status'] == 'reserved'
    reserved = original[0]
    click('[data-testid="v4-stop"]', 'original Stop pauses pending queue')
    paused = '''(()=>({ok:!!document.querySelector('[data-testid="v4-queue-paused-banner"]')&&!!document.querySelector('[data-testid="v4-queue-resume"]')&&[...document.querySelectorAll('li[data-queue-item-id]')].some(e=>e.innerText.includes('PREPUBLISH_QUEUE_C'))&&!document.querySelector('[data-testid="v4-stop"]')}))()'''
    until(paused, 'original paused queue and resume control')
    after = proof('queue-paused')
    own = next(row for row in after['ledger'] if row['id'] == reserved['id'])
    assert own['status'] == 'uncertain' and own['amount'] == reserved['reserved']
    assert not after['held']
    assert 'PREPUBLISH_QUEUE_C' not in json.dumps(after['modelRequests'])
    bridge.raw_cdp('Page.reload')
    until(paused, 'paused queue remains after reload')
    assert proof('queue-paused-reloaded') == after
    click('[data-testid="v4-queue-resume"]', 'original Resume drains C')
    result['checks'].append('original-Stop-persisted-paused-queue-reload-Resume-and-uncertain-reservation')
    return reserved
