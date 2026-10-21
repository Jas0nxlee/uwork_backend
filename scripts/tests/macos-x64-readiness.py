"""Read-only readiness for exactly one owned Electron file renderer, never creates tabs."""
import json
import time
import urllib.request
import urllib.error
from urllib.parse import urlsplit, urlunsplit


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        raise urllib.error.HTTPError(request.full_url, code, 'Owned CDP redirects are forbidden', headers, response)


def fetch_owned_targets(port, seconds):
    assert type(port) is int and 0 < port < 65536
    url = 'http://127.0.0.1:' + str(port) + '/json/list'
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(url, timeout=min(1, seconds)) as response:
        assert response.url == url, 'Owned CDP endpoint must not redirect'
        raw = response.read(262145)
        assert len(raw) <= 262144, 'Owned target list size exceeded'
        return json.loads(raw)


def select_owned_renderer(targets, prefix, port):
    assert prefix.startswith('file:///') and prefix.endswith('/app.asar/')
    assert isinstance(targets, list) and len(targets) <= 64
    pages = [row for row in targets if row.get('type') == 'page']
    owned = [row for row in pages if row.get('url', '').startswith(prefix)]
    assert len(owned) <= 1, 'Ambiguous owned renderers'
    if not owned:
        return None
    assert len(pages) == 1, 'An unrelated page must not precede owned harness attachment'
    row = owned[0]
    address = urlsplit(row.get('webSocketDebuggerUrl', ''))
    assert address.scheme == 'ws' and address.hostname == '127.0.0.1' and address.port == port
    assert address.username is None and address.password is None and not address.query and not address.fragment
    assert address.path == '/devtools/page/' + row['id'], 'Owned target ID must bind the same endpoint'
    return row


def wait_owned_renderer(port, prefix, guard, persist, seconds=30, fetch=fetch_owned_targets,
                        now=time.monotonic, sleep=time.sleep):
    assert type(port) is int and 0 < port < 65536 and 0 < seconds <= 30
    start = now()
    deadline = start + seconds
    observations = []
    attempts = 0
    while now() < deadline:
        attempts += 1
        listener = guard()
        targets = None
        error = None
        selected = None
        if listener:
            try:
                targets = fetch(port, max(.001, deadline - now()))
            except urllib.error.HTTPError as failure:
                failure.close()
                raise
            except (urllib.error.URLError, TimeoutError, OSError) as failure:
                error = type(failure).__name__
            if targets is not None:
                assert guard(), 'Owned Main lost CDP listener during response'
                selected = select_owned_renderer(targets, prefix, port)
        projection = []
        for row in targets or []:
            address = urlsplit(row.get('url', ''))
            projection.append({'id': row.get('id'), 'type': row.get('type'),
                               'urlWithoutQuery': urlunsplit((address.scheme, address.hostname or '', address.path, '', ''))})
        observation = {'seconds': round(now() - start, 3), 'listenerOwned': listener,
                       'targets': projection, 'error': error, 'selectedId': selected['id'] if selected else None}
        if len(observations) < 2:
            observations.append(observation)
        else:
            observations[-1] = observation
        persist({'port': port, 'prefix': prefix, 'attempts': attempts, 'firstLatest': observations})
        if selected:
            return selected
        sleep(min(.15, max(0, deadline - now())))
    raise TimeoutError('Original owned file renderer not ready within 30s budget')
