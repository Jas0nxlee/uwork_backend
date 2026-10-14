"""Project private captures into value-free, reviewable research inventories."""
import json
import re
from pathlib import Path

ROOT = Path.cwd()
INPUT = ROOT / 'evidence/workbuddy'
OUTPUT = ROOT / 'docs/reverse-engineering'
OUTPUT.mkdir(parents=True, exist_ok=True)

def schema_only(value):
    if isinstance(value, list):
        return [schema_only(item) for item in value]
    if not isinstance(value, dict):
        return value
    if value.get('type') == 'array' and 'item_shapes' in value:
        return {'type': 'array', 'item_shapes': schema_only(value['item_shapes'])}
    result = {}
    for key, item in value.items():
        name = '{dynamic-key}' if re.fullmatch(r'\d{6,}|[0-9a-fA-F-]{24,}', key) or len(key) > 80 else key
        result[name] = schema_only(item)
    return result

def path_template(value):
    return re.sub(r'(?<=/)(?:\d{6,}|[0-9a-fA-F]{8}-[0-9a-fA-F-]{27})(?=/|$)', '{id}', value)

pages = []
operations = {}
for file in sorted(INPUT.glob('*.json')):
    raw = json.loads(file.read_text())
    if 'key' not in raw:
        continue
    page = {key: raw.get(key) for key in ['key', 'group', 'label', 'path', 'captured_at', 'columns', 'fields', 'tabs', 'formLabels']}
    page['buttons'] = sorted({button['text'].strip() for button in raw.get('buttons', []) if 0 < len(button['text'].strip()) < 70})
    page['local_evidence'] = {'capture': str(file.relative_to(ROOT)), 'screenshot': str(file.with_suffix('.png').relative_to(ROOT))}
    page['embedded_paths'] = [doc['path'] for doc in raw.get('embeddedDocuments', [])]
    page['http_operations'] = []
    for network in raw.get('network', []):
        if network['path'] == '/v1/traces':
            continue
        operation = {key: network.get(key) for key in ['origin', 'method', 'path', 'status', 'query_keys']}
        operation['path'] = path_template(operation['path'])
        identity = (operation['method'], operation['origin'], operation['path'])
        record = operations.setdefault(identity, {**operation, 'pages': [], 'statuses': [], 'request_shapes': [], 'response_shapes': []})
        if raw['key'] not in record['pages']:
            record['pages'].append(raw['key'])
        if operation['status'] not in record['statuses']:
            record['statuses'].append(operation['status'])
        record['query_keys'] = sorted(set(record['query_keys'] or []) | set(operation['query_keys'] or []))
        for source, target in [('request_shape', 'request_shapes'), ('response_shape', 'response_shapes')]:
            if source in network:
                shape = schema_only(network[source])
                if shape not in record[target]:
                    record[target].append(shape)
        page['http_operations'].append({'method': operation['method'], 'path': operation['path'], 'status': operation['status']})
    pages.append(page)

write = lambda name, data: (OUTPUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
limitations = ['Observed in the current account and subscription on 2026-10-14; hidden permissions and other tenants are not covered.', 'No explicit formal-resource save, publish, delete, purchase, key creation, or task execution was submitted. Cancelling menu editing did trigger an observed server draft DELETE; navigation is not guaranteed side-effect-free.', 'A request can finish after a route transition; page association is an observation window, not proof of a handler-to-request relationship. A null method was not captured and must remain unknown.', 'HTTP 200 and response structure do not prove application success or server-side enforcement.', 'Headers, query values, body values, storage values, user rows, and array sizes are omitted.']
write('runtime-inventory.json', {'authority': 'ui-observation', 'limitations': limitations, 'pages': pages})
write('observed-http.json', {'authority': 'network-observation', 'limitations': limitations, 'operations': sorted(operations.values(), key=lambda item: (item['path'], item['method'] or ''))})
print(json.dumps({'captures': len(pages), 'unique_page_paths': len({page['path'] for page in pages}), 'observed_http_operations': len(operations)}))
