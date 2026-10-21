"""Original B model menu and Composer actions; readonly supplier/accounting verification."""
import json
import time


def execute_b(bridge, fixture, status, catalog, catalog_module, expected, evidence):
    actions = []

    def view(expression):
        return bridge.evaluate(expression)

    def until(expression, label, timeout=30):
        deadline = time.monotonic() + timeout
        last = None
        while time.monotonic() < deadline:
            last = view(expression)
            if last.get('ok'):
                return last
            time.sleep(.2)
        raise AssertionError(label + ': ' + json.dumps(last, ensure_ascii=False))

    def click(selector, label):
        encoded = json.dumps(selector)
        value = view('''(()=>{const es=[...document.querySelectorAll(%s)].filter(e=>e.getBoundingClientRect().width>0);if(es.length!==1)return {count:es.length};const e=es[0];e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {count:1,x,y,hit:e.contains(document.elementFromPoint(x,y)),disabled:e.disabled||e.getAttribute('aria-disabled')==='true'}})()''' % encoded)
        assert value.get('count') == 1 and value.get('hit') and not value.get('disabled'), (label, value)
        for kind in ('mousePressed', 'mouseReleased'):
            bridge.raw_cdp('Input.dispatchMouseEvent', type=kind, x=value['x'], y=value['y'], button='left', clickCount=1)
        actions.append(label)

    before = status(fixture)
    assert before['supplier']['chatMatched'] == 0
    assert before['baseline']['slots']['A']['baselineOnly']
    assert before['baseline']['slots']['B']['baselineOnly']
    click('[data-testid="chat-model-select-trigger"]', 'open-original-model-menu')
    raw, current = catalog.observe()
    if current['canExpandUcas']:
        point = current['controls']['ucas']
        assert point['visible'] and point['hit'] and not point['disabled']
        for kind in ('mousePressed', 'mouseReleased'):
            bridge.raw_cdp('Input.dispatchMouseEvent', type=kind, x=point['x'], y=point['y'], button='left', clickCount=1)
        actions.append('expand-original-ucas-group')
    item = catalog_module['item_id'](expected['B']['modelId'])
    click('[data-testid=' + json.dumps(item) + ']', 'select-exact-B-model')
    selected = until('''(()=>{const e=document.querySelector('[data-testid="v4-model-config"][data-source="composer"]');return {ok:e?.getAttribute('data-model')===%s,model:e?.getAttribute('data-model')}})()''' % json.dumps(expected['B']['modelId']), 'B model selection')
    editor = '[data-testid="v4-composer"] [contenteditable="true"]'
    empty = view('''(()=>{const e=document.querySelector(%s);return {exists:!!e,text:e?.innerText??''}})()''' % json.dumps(editor))
    assert empty['exists'] and not empty['text'].strip(), 'Original draft must be empty before one send'
    click(editor, 'focus-original-composer')
    prompt = 'G04K-B-EXECUTION-20261020：请简短回复，不调用工具。'
    bridge.raw_cdp('Input.insertText', text=prompt)
    until('''(()=>{const e=document.querySelector(%s),b=document.querySelector('[data-testid="v4-composer-send"]');return {ok:e?.innerText===%s&&!!b&&!b.disabled,textMatches:e?.innerText===%s}})()''' % (json.dumps(editor), json.dumps(prompt), json.dumps(prompt)), 'Original draft input')
    actions.append('insert-fixed-prompt-through-CDP-input')
    click('[data-testid="v4-composer-send"]', 'click-original-send-once')
    terminal = until('''(()=>{const text=document.body.innerText;return {ok:text.includes('原生企业资产联动完成。')&&!document.querySelector('[data-testid="v4-stop"]'),answerVisible:text.includes('原生企业资产联动完成。'),promptVisible:text.includes(%s),stopVisible:!!document.querySelector('[data-testid="v4-stop"]')}})()''' % json.dumps(prompt), 'B original answer and terminal', 60)
    deadline = time.monotonic() + 45
    after = None
    while time.monotonic() < deadline:
        after = status(fixture)
        count = after['supplier']['chatMatched']
        assert count <= 2, 'Bounded main/title model budget exceeded'
        b = after['baseline']['slots']['B']
        if count == 2 and b['ledgerRows'] == 3 and b['traceRows'] == 2 and b['amount'] == 55:
            break
        time.sleep(.3)
    assert after['supplier']['chatMatched'] == 2
    assert after['supplier']['rejected'] == 0
    assert after['baseline']['slots']['A'] == before['baseline']['slots']['A']
    b = after['baseline']['slots']['B']
    assert b['allBelongExpectedMember'] and b['ledgerRows'] == 3
    assert b['amount'] == 55 and b['traceRows'] == 2 and b['gatewayCallRows'] == 2, b
    facts = {'modelCalls': 2, 'actions': actions, 'selectedModelMatchesB': selected['ok'],
             'terminal': terminal, 'before': before['baseline']['slots'], 'after': after['baseline']['slots'],
             'BNewCredits': 44, 'BSyntheticBaselineCredits': 11, 'ANewCredits': 0,
             'boundary': 'original Native A/logout/B login, B model selection and one Composer Send; controlled local supplier'}
    (evidence / 'b-execution-proof.json').write_text(json.dumps(facts, ensure_ascii=False, indent=2) + '\n')
    return facts
