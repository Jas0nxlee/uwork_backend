#!/usr/bin/env python3
"""G07e probe: original composer attachment consumption under the enterprise filesystem admission.

Feeds real files into the composer's mounted file input (CDP DOM.setFileInputFiles, no OS
dialog). Electron resolves their real local paths through webUtils.getPathForFile, so every
attachment travels the original local-path AttachmentRef pipeline. Runs a text, an image and a
PDF attachment with the current policy allowing the filesystem, then the same three with the
policy revoked, and asserts what the model request actually received.

The `panel-interaction` phase drives the real NSOpenPanel: its elements are located by their
WindowServer frame through the Accessibility API and acted on with element-scoped presses, so no
synthetic event is posted to the desktop; the key routes remain as fallbacks. Not the reviewed
Go/actor ceremony.
"""
import argparse, base64, ctypes, ctypes.util, importlib.util, json, os, re, shutil, subprocess, sys, time
from ctypes import c_bool as C_bool
from pathlib import Path

REPO = Path('/Users/ljp/Desktop/uwork_backend')
_harness_spec = importlib.util.spec_from_file_location(
    'native_g04k_probe', REPO / 'scripts/tests/native-g04k-cdp-probe.py')
harness = importlib.util.module_from_spec(_harness_spec)
_harness_spec.loader.exec_module(harness)
need = harness.need
ProbeError = harness.ProbeError
LAST = harness.LAST_OBSERVATIONS

ALLOW_MARKER = 'NATIVE_ATTACHMENT_ALLOW_MARKER_7f31'
DENY_MARKER = 'NATIVE_ATTACHMENT_DENY_MARKER_9c02'
TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
OMMISSION = {
    'image': '[Media omitted from provider request because the selected model does not support image input.]',
    'video': '[Media omitted from provider request because the selected model does not support video input.]',
    'pdf': '[Media omitted from provider request because the selected model does not support PDF input.]',
}
NOTE_RE = re.compile(r'\[(?:Attached|PDF: source:|Image: source:|Media omitted)[^\]]{0,200}\]')

COMPOSER_DOM = r'''(()=>{
  let invalid=false;const overflow=[];
  const list=(s,b=document,n=64)=>{const a=Array.from(b?.querySelectorAll(s)??[]);if(a.length>n){invalid=true;overflow.push(s+':'+a.length);return [];}return a;};
  const one=id=>{const a=list('[data-testid="'+id+'"]');return a.length===1?a[0]:null;};
  const visible=e=>!!e&&!e.hidden&&!e.closest('[hidden],[aria-hidden="true"],[inert]')&&e.getClientRects().length>0;
  const text=(e,n=256)=>{if(!e)return null;const t=(e.textContent??'').replace(/\s+/g,' ').trim();if(t.length>n){invalid=true;return null;}return t||null;};
  const point=e=>{if(!visible(e))return null;const r=e.getBoundingClientRect(),l=Math.max(0,r.left),t=Math.max(0,r.top),z=Math.min(innerWidth,r.right),b=Math.min(innerHeight,r.bottom);if(z<=l||b<=t)return null;const x=(l+z)/2,y=(t+b)/2,h=document.elementFromPoint(x,y);return{x,y,visible:true,hit:!!h&&(h===e||e.contains(h)),disabled:e.disabled===true||e.getAttribute('aria-disabled')==='true'};};
  const composer=one('v4-composer-input'),send=one('v4-composer-send');
  const attachButton=one('chat-attachment-button'),attachItem=one('chat-attachment-menu-item');
  const chips=list('[data-testid^="v4-attachment-"]',document,12)
    .filter(e=>!/upload|error/u.test(e.getAttribute('data-testid')??''));
  const rows=list('[data-testid="v4-row-attachments"]',document,8);
  return{version:1,invalid,overflow,
    composerPoint:point(composer),composerText:composer?String(composer.value??composer.innerText??'').slice(0,80):null,
    sendPoint:point(send),sendDisabled:send?send.disabled===true:null,
    attachButton:point(attachButton),attachItem:point(attachItem),
    attachItemText:attachItem?text(attachItem,48):null,
    fileInputCount:list('input[type="file"]',document,4).length,
    chipCount:chips.length,chips:chips.map(e=>({text:text(e,96),id:e.getAttribute('data-attachment-id')??null})),
    rowCount:rows.length,rowText:rows.map(e=>text(e,120)),
    attachmentErrors:list('[data-testid="v4-attachment-error"],[role="alert"]',document,4).map(e=>text(e,160)),
    timeline:text(one('v4-timeline'),600)};})()'''


def project(bridge, label=None):
    value = bridge.evaluate(COMPOSER_DOM)
    if label:
        LAST[label] = value
    need(value.get('invalid') is False,
         'composer projection was ambiguous: ' + ','.join(value.get('overflow') or []))
    return value


def wait_for(read, predicate, seconds, label):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = read()
        if predicate(last):
            return last
        time.sleep(0.4)
    LAST[label] = last
    raise ProbeError('no match: ' + label + ' last=' + json.dumps(last, ensure_ascii=False)[:400])


def feed_file(bridge, path):
    """Set a real file on the composer's mounted file input; Electron resolves its local path."""
    element = bridge.call({
        'method': 'Runtime.evaluate', 'sessionId': bridge.session,
        'params': {'expression': "document.querySelector('input[type=file]')"},
    })
    object_id = (element.get('result') or {}).get('objectId')
    need(object_id, 'the composer file input was not found in the renderer')
    bridge.call({
        'method': 'DOM.setFileInputFiles', 'sessionId': bridge.session,
        'params': {'files': [str(path)], 'objectId': object_id},
    })


def model_requests(fixtures, evidence, name):
    fixtures.command('experienceSnapshot', 60, name=name)
    proof = json.loads((evidence / f'{name}-experience-proof.json').read_text())
    return proof.get('modelRequests') or []


def contains_marker(requests, marker):
    return [index for index, body in enumerate(requests)
            if marker in json.dumps(body, ensure_ascii=False)]


def payload_prefix(path, size=32):
    """A base64 fragment that can only appear if the file bytes themselves were inlined."""
    raw = base64.b64encode(Path(path).read_bytes()).decode('ascii')
    return raw[:size] if len(raw) >= size else None


def extra_lines(text):
    """Delivery notes the runtime adds for an attachment, taken verbatim from the request body."""
    return sorted(set(NOTE_RE.findall(text)))[:8]


def write_tiny_video(path, colour):
    """A real, parseable MP4 through the local ffmpeg so the media branch can process it."""
    subprocess.run(
        ['/opt/homebrew/bin/ffmpeg', '-hide_banner', '-loglevel', 'error',
         '-f', 'lavfi', '-i', 'color=c=%s:s=32x32:d=1' % colour,
         '-c:v', 'mpeg4', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', str(path)],
        check=True, timeout=60)
    need(path.stat().st_size > 0, 'the tiny video was not written')


def minimal_pdf(label):
    """A minimal single-page PDF whose content stream carries the given label text."""
    stream = ('BT /F1 12 Tf 20 50 Td (%s) Tj ET' % label).encode('ascii')
    objects = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        (b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R '
         b'/Resources << /Font << /F1 5 0 R >> >> >>'),
        b'<< /Length ' + str(len(stream)).encode('ascii') + b' >>\nstream\n' + stream + b'\nendstream',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    out = bytearray(b'%PDF-1.4\n')
    offsets = []
    for index, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b'%d 0 obj\n' % index + body + b'\nendobj\n'
    xref = len(out)
    out += b'xref\n0 %d\n' % (len(objects) + 1) + b'0000000000 65535 f \n'
    for offset in offsets:
        out += b'%010d 00000 n \n' % offset
    out += (b'trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n'
            % (len(objects) + 1, xref))
    return bytes(out)


def ctypes_load_coregraphics():
    return ctypes.cdll.LoadLibrary('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')


def press_key(pid, keycode, flags=0):
    """One key down/up pair on the ordinary HID path (native sheets accept only that path)."""
    core_graphics = ctypes_load_coregraphics()
    core_foundation = ctypes.cdll.LoadLibrary(ctypes.util.find_library('CoreFoundation'))
    core_graphics.CGEventSourceCreate.restype = ctypes.c_void_p
    core_graphics.CGEventSourceCreate.argtypes = [ctypes.c_uint32]
    core_graphics.CGEventCreateKeyboardEvent.restype = ctypes.c_void_p
    core_graphics.CGEventCreateKeyboardEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint16, C_bool]
    core_graphics.CGEventSetFlags.argtypes = [ctypes.c_void_p, ctypes.c_uint64]
    core_graphics.CGEventPost.restype = None
    core_graphics.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
    core_foundation.CFRelease.argtypes = [ctypes.c_void_p]
    source = core_graphics.CGEventSourceCreate(0)
    need(source, 'no synthetic event source was available')
    for pressed in (True, False):
        event = core_graphics.CGEventCreateKeyboardEvent(source, keycode, pressed)
        need(event, 'the synthetic key event was not created')
        if flags:
            core_graphics.CGEventSetFlags(event, flags)
        core_graphics.CGEventPost(0, event)
        core_foundation.CFRelease(event)
        time.sleep(0.02)
    core_foundation.CFRelease(source)


def send_unicode_keys(pid, commands, mode='pid'):
    """PID-directed synthetic keys (CGEventPostToPid), never a global post.

    Reached only after CGPreflightPostEventAccess() and the owned-frontmost guard pass, so a
    keystroke can never be delivered to another application's window.
    """
    core_graphics = ctypes_load_coregraphics()
    core_foundation = ctypes.cdll.LoadLibrary(ctypes.util.find_library('CoreFoundation'))
    core_graphics.CGEventSourceCreate.restype = ctypes.c_void_p
    core_graphics.CGEventSourceCreate.argtypes = [ctypes.c_uint32]
    core_graphics.CGEventCreateKeyboardEvent.restype = ctypes.c_void_p
    core_graphics.CGEventCreateKeyboardEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint16, C_bool]
    core_graphics.CGEventSetFlags.argtypes = [ctypes.c_void_p, ctypes.c_uint64]
    core_graphics.CGEventKeyboardSetUnicodeString.restype = None
    core_graphics.CGEventKeyboardSetUnicodeString.argtypes = [
        ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_uint16)]
    core_graphics.CGEventPostToPid.restype = None
    core_graphics.CGEventPostToPid.argtypes = [ctypes.c_int, ctypes.c_void_p]
    core_graphics.CGEventPost.restype = None
    core_graphics.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
    core_foundation.CFRelease.argtypes = [ctypes.c_void_p]

    source = core_graphics.CGEventSourceCreate(0)
    need(source, 'no synthetic event source was available')
    virtual_keys = {'g': 5, 'return': 36, 'escape': 53}
    command_flags = {'cmd+shift+g': 0x00100000 | 0x00020000, 'escape': 0}

    def post(keycode, pressed, flags):
        event = core_graphics.CGEventCreateKeyboardEvent(source, keycode, pressed)
        need(event, 'the synthetic key event was not created')
        if flags:
            core_graphics.CGEventSetFlags(event, flags)
        if mode == 'global':
            # kCGHIDEventTap: the ordinary HID path, which native AppKit sheets accept.
            core_graphics.CGEventPost(0, event)
        else:
            core_graphics.CGEventPostToPid(pid, event)
        core_foundation.CFRelease(event)

    for command in commands:
        if isinstance(command, int):
            # A bare virtual keycode: used by the panel sequences (Return, Tab, Space).
            post(command, True, 0)
            post(command, False, 0)
            continue
        if command.startswith('text:'):
            payload = command[5:]
            encoded = payload.encode('utf-16-le')
            units = len(encoded) // 2
            buffer = (ctypes.c_uint16 * units).from_buffer_copy(encoded)
            for pressed in (True, False):
                event = core_graphics.CGEventCreateKeyboardEvent(source, 0, pressed)
                need(event, 'the synthetic text event was not created')
                core_graphics.CGEventKeyboardSetUnicodeString(event, units, buffer)
                if mode == 'global':
                    core_graphics.CGEventPost(0, event)
                else:
                    core_graphics.CGEventPostToPid(pid, event)
                core_foundation.CFRelease(event)
            continue
        name = command.rsplit('+', 1)[-1]
        for pressed in (True, False):
            post(virtual_keys[name], pressed, command_flags.get(command, 0))
    core_foundation.CFRelease(source)


def reopen_panel(bridge, guards, read):
    entry = wait_for(read, lambda v: v['attachButton'], 30, 'attachment button for the next case')
    harness.click_point(bridge, entry['attachButton'])
    menu = wait_for(read, lambda v: v['attachItem'], 30, 'attachment menu item for the next case')
    harness.click_point(bridge, menu['attachItem'])
    time.sleep(1.5)


WINDOW_SIGNATURE = lambda window: json.dumps(
    [window['ownerPid'], window['windowName'], window['bounds']], sort_keys=True)


def extra_windows(before, current):
    known = {WINDOW_SIGNATURE(window) for window in before['windows']}
    return [window for window in current['windows'] if WINDOW_SIGNATURE(window) not in known]


def wait_extra_window(electron_pid, before, seconds, label):
    """The next owned window the WindowServer shows beyond the known set."""
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        current = owned_window_list(electron_pid)
        extra = extra_windows(before, current)
        if extra:
            return {'count': current['count'], 'extra': extra, 'windows': current['windows']}
        time.sleep(0.4)
    return None


_ax_spec = importlib.util.spec_from_file_location(
    'macos_ax_driver', REPO / 'scripts/tests/macos-ax-driver.py')
ax_driver = importlib.util.module_from_spec(_ax_spec)
_ax_spec.loader.exec_module(ax_driver)

AX_ACCEPT_TITLES = ('打开', 'Open', '选择', 'Choose')
AX_CANCEL_TITLES = ('取消', 'Cancel')
AX_SHEET_COMMIT_TITLES = ('前往', 'Go', '前往文件夹', '打开', 'Open', '好', 'OK', 'Select')
AX_GOTO_FIELD_HINTS = ('文件夹', 'folder', 'Go to', '位置', 'Location', '路径', 'Path')
AX_OPEN = 'AXOpen'


def ax_items(array_ref):
    """Retained copies of the elements an AX array attribute holds."""
    out = []
    if not array_ref:
        return out
    for index in range(ax_driver._CF.CFArrayGetCount(array_ref)):
        item = ax_driver._CF.CFArrayGetValueAtIndex(array_ref, index)
        if item:
            ax_driver._CF.CFRetain(item)
            out.append(item)
    ax_driver._CF.CFRelease(array_ref)
    return out


def ax_release(refs):
    for ref in refs:
        try:
            ax_driver._CF.CFRelease(ref)
        except Exception:
            pass


def ax_candidates(pid):
    """App element plus every window, attached sheet and sheet-like child: a panel lives there."""
    app = ax_driver.element(pid)
    refs = [app]
    windows, _ = ax_driver.attribute_element(app, ax_driver.WINDOWS)
    for window in ax_items(windows):
        refs.append(window)
        sheets, _ = ax_driver.attribute_element(window, ax_driver.SHEETS)
        refs.extend(ax_items(sheets))
        children, _ = ax_driver.attribute_element(window, ax_driver.CHILDREN)
        for child in ax_items(children):
            role, _ = ax_driver.attribute(child, ax_driver.ROLE)
            if role in ('AXSheet', 'AXDialog', 'AXPopover'):
                refs.append(child)
            else:
                ax_driver.release(child)
    return refs


def frame_matches(info, bounds, tolerance=24):
    box = info.get('frame')
    if not box or not bounds:
        return False
    return all(abs((box.get(key) or 0) - (bounds.get(key) or 0)) <= tolerance
               for key in ('X', 'Y', 'Width', 'Height'))


def ax_locate(pid, bounds, tolerance=24, depth=7, max_nodes=300):
    """The AX node for a WindowServer window/sheet, its subtree, and its retained refs.

    The caller owns ``refs`` and ``nodes`` and must release both with ax_release().
    """
    refs = ax_candidates(pid)
    for ref in refs:
        info = ax_driver.describe(ref)
        if info.get('role') in ('AXWindow', 'AXSheet', 'AXDialog', 'AXPopover') and \
                frame_matches(info, bounds, tolerance):
            nodes = ax_driver.collect(ref, max_depth=depth, max_nodes=max_nodes)
            return ref, info, nodes, refs
    ax_release(refs)
    return None, None, [], []


def ax_find(nodes, roles, titles=None, hints=None):
    """First node with a matching role and a title/description/placeholder in the candidates."""
    for ref, info in nodes:
        if info.get('role') not in roles:
            continue
        candidates = [c for c in (info.get('title'), info.get('description'),
                                  info.get('placeholder')) if c]
        if titles is not None and not any(c in titles for c in candidates):
            continue
        if hints is not None and not any(hint in candidate for hint in hints for candidate in candidates):
            continue
        return ref, info
    return None, None


def ax_press(ref, action=ax_driver.PRESS):
    return ax_driver.perform(ref, action)


def ax_node_label(info):
    if not info:
        return None
    return {'role': info.get('role'), 'title': info.get('title'),
            'description': info.get('description'), 'placeholder': info.get('placeholder'),
            'frame': info.get('frame')}


ACTIONABLE_ROLES = ('AXButton', 'AXTextField', 'AXComboBox', 'AXMenuButton', 'AXPopUpButton',
                    'AXMenuItem', 'AXSearchField', 'AXSheet', 'AXToolbar', 'AXPopover')


def ax_controls(nodes, limit=40):
    """The actionable controls under a node, for the evidence journal."""
    out = []
    for _, info in nodes:
        if info.get('role') in ACTIONABLE_ROLES:
            out.append(ax_node_label(info))
        if len(out) >= limit:
            break
    return out


def write_ax_evidence(evidence, name, nodes):
    """The bounded AX subtree as its own evidence file."""
    path = evidence / (name + '.json')
    path.write_text(json.dumps(ax_driver.to_json(nodes), ensure_ascii=False, indent=1) + '\n',
                    encoding='utf-8')
    os.chmod(path, 0o600)
    return str(path.name)


def panel_document(panel_ref, journal):
    """The panel's current folder, and whether AX may set it (opens no sheet, touches no key)."""
    value, code = ax_driver.attribute(panel_ref, 'AXDocument')
    settable, _ = ax_driver.settable(panel_ref, 'AXDocument')
    journal.append({'step': 'panel-document', 'value': value, 'readCode': code, 'settable': settable})
    return value, settable


def panel_rows(panel_ref, name=None, depth=9, max_nodes=420):
    """Retained panel nodes plus the row whose name cell matches, when asked for one."""
    nodes = ax_driver.collect(panel_ref, max_depth=depth, max_nodes=max_nodes)
    row = None
    for ref, info in nodes:
        if info.get('role') in ('AXTextField', 'AXStaticText') and info.get('value') == name:
            row = (ref, info)
            break
    return nodes, row


def navigate_panel_to_folder(electron_pid, panel_ref, target, baseline_count, bridge, journal):
    """Bring the target's folder into the panel: AX document first, the go-to sheet as fallback.

    Setting the panel's own document URL touches nothing on the desktop. The go-to sheet needs a
    real key event, so it is used only when the AX route does not reach the folder.
    """
    url = target.parent.as_uri()
    _, settable = panel_document(panel_ref, journal)
    if settable:
        code = ax_driver.set_value(panel_ref, 'AXDocument', url)
        journal.append({'step': 'set-panel-document', 'url': url, 'code': code})
        for _ in range(8):
            time.sleep(0.5)
            nodes, row = panel_rows(panel_ref, target.name)
            ax_release([ref for ref, _ in nodes])
            if row is not None:
                journal.append({'step': 'folder-reached', 'route': 'ax-document', 'file': target.name})
                return {'route': 'ax-document', 'reached': True}
    sheet_state = open_go_to_sheet(electron_pid, baseline_count + 1, bridge, panel_ref, journal)
    if not sheet_state['opened']:
        journal.append({'step': 'folder-not-reached', 'route': 'ax-document+go-to'})
        return {'route': 'ax-document+go-to', 'reached': False}
    sheet_ref, sheet_info, sheet_nodes, sheet_refs = ax_locate(
        electron_pid, last_extra_window_bounds(electron_pid, baseline_count))
    try:
        journal.append({'step': 'locate-sheet', 'found': sheet_ref is not None,
                        'element': ax_node_label(sheet_info), 'controls': ax_controls(sheet_nodes)})
        field, _ = fill_go_to_path(electron_pid, sheet_nodes, target, bridge, journal)
        commit = commit_go_to_sheet(electron_pid, sheet_nodes, field, baseline_count + 1,
                                    bridge, journal)
        journal.append({'step': 'go-to-commit', 'closed': commit['closed'], 'mode': commit['mode']})
        for _ in range(6):
            time.sleep(0.5)
            nodes, row = panel_rows(panel_ref, target.name)
            ax_release([ref for ref, _ in nodes])
            if row is not None:
                journal.append({'step': 'folder-reached', 'route': 'go-to', 'file': target.name})
                return {'route': 'go-to', 'reached': True}
    finally:
        ax_release([ref for ref, _ in sheet_nodes])
        ax_release(sheet_refs)
    journal.append({'step': 'folder-not-reached', 'route': 'go-to'})
    return {'route': 'go-to', 'reached': False}


def last_extra_window_bounds(electron_pid, baseline_count):
    """The bounds of the smallest owned layer-0 window, which is the sheet on top of the panel."""
    layer_zero = [window for window in owned_window_list(electron_pid)['windows']
                  if window['layer'] == 0]
    if len(layer_zero) <= baseline_count:
        return None
    smallest = min(layer_zero,
                   key=lambda window: (window['bounds']['Width'] or 0) * (window['bounds']['Height'] or 0))
    return smallest['bounds']


def open_go_to_sheet(electron_pid, baseline_count, bridge, panel_ref, journal):
    """Open the panel's go-to sheet: this panel exposes no menu item for it, so a real key is it.

    The panel window is raised and focused first so the key lands in it; the PID-directed and
    System Events routes are tried in that order and every outcome is journalled.
    """
    raise_code = ax_press(panel_ref, 'AXRaise')
    focused, _ = ax_driver.settable(panel_ref, 'AXFocused')
    journal.append({'step': 'raise-panel', 'raiseCode': raise_code, 'focusSettable': focused,
                    'frontmostPid': frontmost_normal_pid()})
    for mode in ('pid-key', 'global-key', 'system-events-key'):
        guard_frontmost(electron_pid, 'go-to:' + mode, bridge)
        if mode == 'pid-key':
            send_unicode_keys(electron_pid, ['cmd+shift+g'])
        elif mode == 'global-key':
            send_unicode_keys(electron_pid, ['cmd+shift+g'], mode='global')
        else:
            system_events_key(5, ('command', 'shift'))
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            if owned_window_list(electron_pid)['count'] > baseline_count:
                journal.append({'step': 'go-to-sheet-opened', 'mode': mode})
                return {'mode': mode, 'opened': True}
            time.sleep(0.3)
        journal.append({'step': 'go-to-sheet-not-opened', 'mode': mode})
    return {'mode': None, 'opened': False}


def fill_go_to_path(electron_pid, sheet_nodes, path, bridge, journal):
    """Set the sheet's path field and commit it, preferring AX and verifying each step."""
    field, field_info = ax_find(sheet_nodes, ('AXTextField', 'AXComboBox'), hints=AX_GOTO_FIELD_HINTS)
    if field is None:
        field, field_info = ax_find(sheet_nodes, ('AXTextField', 'AXComboBox'))
    entry = {'element': ax_node_label(field_info)}
    if field is not None:
        settable, _ = ax_driver.settable(field, ax_driver.VALUE)
        entry['valueSettable'] = settable
        if settable:
            entry['setValueCode'] = ax_driver.set_value(field, ax_driver.VALUE, str(path))
            readback, _ = ax_driver.attribute(field, ax_driver.VALUE)
            entry['valueAfterSet'] = readback
            entry['valueMatches'] = readback == str(path)
        if not entry.get('valueMatches'):
            guard_frontmost(electron_pid, 'go-to path', bridge)
            system_events_type(str(path))
            entry['typedBySystemEvents'] = True
            readback, _ = ax_driver.attribute(field, ax_driver.VALUE)
            entry['valueAfterTyping'] = readback
    else:
        guard_frontmost(electron_pid, 'go-to path', bridge)
        system_events_type(str(path))
        entry['typedBySystemEvents'] = True
    time.sleep(1.0)
    journal.append(dict(entry, step='fill-path'))
    return field, field_info


def commit_go_to_sheet(electron_pid, sheet_nodes, field, before_count, bridge, journal):
    """Commit the sheet so the panel navigates to the typed path; every route is journalled."""
    if field is not None:
        entry = {'step': 'confirm-field', 'code': ax_press(field, ax_driver.CONFIRM)}
        journal.append(entry)
        _await_sheet_close(electron_pid, before_count, 2.5)
        if owned_window_list(electron_pid)['count'] <= before_count:
            journal.append({'step': 'sheet-closed', 'mode': 'ax-confirm'})
            return {'mode': 'ax-confirm', 'closed': True}
    button, button_info = ax_find(sheet_nodes, ('AXButton',), titles=AX_SHEET_COMMIT_TITLES)
    if button is None:
        button, button_info = ax_find(sheet_nodes, ('AXButton',))
    if button is not None:
        journal.append({'step': 'press-sheet-button', 'code': ax_press(button),
                        'element': ax_node_label(button_info)})
        _await_sheet_close(electron_pid, before_count, 2.5)
        if owned_window_list(electron_pid)['count'] <= before_count:
            journal.append({'step': 'sheet-closed', 'mode': 'ax-button'})
            return {'mode': 'ax-button', 'closed': True}
    for keys in ([36], [53, 36], [48, 49], [48, 49]):
        guard_frontmost(electron_pid, 'commit', bridge)
        for keycode in keys:
            system_events_key(keycode)
        _await_sheet_close(electron_pid, before_count, 2.0)
        journal.append({'step': 'key-commit', 'keys': keys,
                        'windows': owned_window_list(electron_pid)['count']})
        if owned_window_list(electron_pid)['count'] <= before_count:
            journal.append({'step': 'sheet-closed', 'mode': 'keys'})
            return {'mode': 'keys', 'closed': True}
    return {'mode': None, 'closed': False}


def _await_sheet_close(electron_pid, before_count, seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if owned_window_list(electron_pid)['count'] <= before_count:
            return True
        time.sleep(0.3)
    return False


def select_row(electron_pid, row_ref, row_info, before_count, journal, case):
    """Ask the row itself to open: whichever supported action closes the panel is the one used."""
    codes = {}
    for action in ('AXPick', 'AXConfirm', AX_OPEN):
        if action not in (row_info.get('actions') or []):
            continue
        codes[action] = ax_press(row_ref, action)
        closed = _await_sheet_close(electron_pid, before_count, 2)
        if closed:
            break
    journal.append({'step': 'open-row', 'case': case, 'codes': codes,
                    'actions': row_info.get('actions'), 'element': ax_node_label(row_info)})
    return codes


def accept_panel(electron_pid, panel_nodes, before_count, bridge, journal):
    """Accept the panel's current selection through its own button, Return as the fallback.

    Every attempt records the AX code and the window counts around it, so a failure is never
    reported as the mechanism that closed the panel.
    """
    button, button_info = ax_find(panel_nodes, ('AXButton',), titles=AX_ACCEPT_TITLES)
    code = ax_press(button) if button is not None else None
    opened_before = owned_window_list(electron_pid)['count']
    closed = _await_sheet_close(electron_pid, before_count, 3)
    journal.append({'step': 'press-accept', 'code': code, 'windowsBefore': opened_before,
                    'closedAfter': closed, 'element': ax_node_label(button_info)})
    if code == 0 and closed:
        journal.append({'step': 'panel-closed', 'mode': 'ax-accept'})
        return 'ax-accept'
    guard_frontmost(electron_pid, 'accept', bridge)
    opened_before = owned_window_list(electron_pid)['count']
    system_events_key(36)
    closed = _await_sheet_close(electron_pid, before_count, 3)
    journal.append({'step': 'return-accept', 'windowsBefore': opened_before, 'closedAfter': closed})
    if closed:
        journal.append({'step': 'panel-closed', 'mode': 'return-key'})
        return 'return-key'
    journal.append({'step': 'panel-still-open', 'windows': owned_window_list(electron_pid)['count']})
    return None


def dismiss_panel(electron_pid, panel_nodes, baseline_count, bridge, journal):
    """Close a panel without a selection, through its own Cancel button when AX finds it."""
    button, button_info = ax_find(panel_nodes, ('AXButton',), titles=AX_CANCEL_TITLES)
    if button is not None:
        journal.append({'step': 'press-cancel', 'code': ax_press(button),
                        'element': ax_node_label(button_info)})
        if _await_sheet_close(electron_pid, baseline_count, 3):
            journal.append({'step': 'panel-closed', 'mode': 'ax-cancel'})
            return {'closed': True, 'mode': 'ax-cancel'}
    closed = close_panel_with_escape(electron_pid, baseline_count, bridge)
    journal.append({'step': 'escape-dismiss', 'closed': closed})
    return {'closed': closed is not None, 'mode': 'escape'}



def key_probe(profile, evidence, checks, observations, fixtures, bridge, guards, electron_pid, read):
    """Does the PID-directed synthetic key variant actually deliver without the TCC grant?

    Posts one harmless unicode key to our own owned window and checks whether the renderer saw
    it. Decisive either way: it separates "CGPreflightPostEventAccess is conservative" from
    "synthetic keys are truly denied", using only our own test process as the target.
    """
    observations['preflight'] = post_event_access()
    checks.append('recorded-the-synthetic-key-preflight-result')
    guard_frontmost(electron_pid, 'key-probe')
    checks.append('owned-frontmost-guard-passed-before-any-input')
    before = read()
    harness.click_point(bridge, before['composerPoint'])
    typed = wait_for(read, lambda v: True, 3, 'composer focused')
    sent = sent_before = None
    marker = 'zz'
    send_unicode_keys(electron_pid, ['text:' + marker])
    time.sleep(3)
    after = read()
    delivered = marker in (after['composerText'] or '')
    observations['keyProbe'] = {'preflight': observations['preflight'], 'marker': marker,
                                'composerBefore': typed['composerText'], 'composerAfter': after['composerText'],
                                'delivered': delivered}
    if delivered:
        checks.append('pid-directed-synthetic-keys-reached-the-owned-window')
    else:
        checks.append('pid-directed-synthetic-keys-did-not-reach-the-owned-window')
    fixtures.send({'op': 'stopNative'})
    time.sleep(3)
    remaining = owned_window_list(electron_pid)
    observations['windowsAfterTeardown'] = {'count': remaining['count']}
    need(remaining['count'] == 0, 'the owned process still shows a window after teardown')
    checks.append('probe-torn-down-with-its-owned-process')
    return finish(profile, evidence, checks, observations, fixtures, bridge, guards,
                  'passed' if delivered else 'blocked')


def owned_window_list(pid):
    """WindowServer metadata for the owned process; no Accessibility or screen capture."""
    completed = subprocess.run([sys.executable, str(REPO / 'scripts/tests/macos-window-list.py'), str(pid)],
                               capture_output=True, text=True, timeout=30)
    need(completed.returncode == 0, 'the window projection helper failed')
    return json.loads(completed.stdout)


def post_event_access():
    """The exact API for posting synthetic key events; without it no keystroke may be sent."""
    core_graphics = ctypes_load_coregraphics()
    core_graphics.CGPreflightPostEventAccess.restype = C_bool
    return bool(core_graphics.CGPreflightPostEventAccess())


def window_projection(mode):
    completed = subprocess.run([sys.executable, str(REPO / 'scripts/tests/macos-window-list.py'), mode],
                               capture_output=True, text=True, timeout=30)
    need(completed.returncode == 0, 'the window projection helper failed')
    return json.loads(completed.stdout)


def frontmost_normal_pid():
    return window_projection('--front')['frontmostNormalPid']


def frontmost_visible():
    """The frontmost window above layer 0: a system dialog raised over the app counts here."""
    return window_projection('--front-all')


def visible_windows():
    return window_projection('--visible')


def guard_frontmost(pid, step, bridge=None):
    """Every synthetic key batch is preceded by an owned-frontmost check, never after.

    A posted key goes to whatever is frontmost, so this is the safety property: it covers
    windows above layer 0 as well, which is where a system alert or sheet would sit.
    The owned window is re-activated first because another app (including the host UWork) may
    have taken focus; if the topmost window still is not ours, the batch is refused.
    """
    front = None
    for attempt in range(4):
        if attempt == 0:
            activate_owned_app(pid)
        front = frontmost_visible()
        if front['frontmostPid'] == pid:
            return
        if bridge is not None:
            try:
                bridge.call({'method': 'Page.bringToFront', 'sessionId': bridge.session}, seconds=10)
            except ProbeError:
                pass
        time.sleep(1.0)
    front = frontmost_visible()
    need(front['frontmostPid'] == pid,
         'refusing to send keys for ' + step + ': the frontmost window above layer 0 belongs to '
         + str(front['frontmostName']) + ' (pid ' + str(front['frontmostPid']) + ', layer '
         + str(front['frontmostLayer']) + '), not the owned Electron ' + str(pid))


# US-layout virtual keycodes for the characters an owned workspace path can contain.
KEYCODES = {
    'a': 0, 's': 1, 'd': 2, 'f': 3, 'h': 4, 'g': 5, 'z': 6, 'x': 7, 'c': 8, 'v': 9,
    'b': 11, 'q': 12, 'w': 13, 'e': 14, 'r': 15, 'y': 16, 't': 17, 'o': 31, 'u': 32,
    'i': 34, 'p': 35, 'l': 37, 'j': 38, 'k': 40, 'n': 45, 'm': 46,
    '1': 18, '2': 19, '3': 20, '4': 21, '5': 23, '6': 22, '7': 26, '8': 28, '9': 25, '0': 29,
    '-': 27, '=': 24, '[': 33, ']': 30, ';': 41, "'": 39, ',': 43, '.': 47, '/': 44,
    '\\': 42, '`': 50, ' ': 49,
}
SHIFT = 0x00020000
COMMAND = 0x00100000
SHIFT_FREE_COMMAND = COMMAND


def keycodes_for(text):
    """(virtual keycode, needs-shift) per character; a HID key needs a real keycode."""
    out = []
    for character in text:
        lower = character.lower()
        shifted = character.isupper()
        if lower in ('_',) or character in ('_',):
            out.append((27, True))          # shift + minus
            continue
        if character in (':',):
            out.append((41, True))          # shift + semicolon
            continue
        need(lower in KEYCODES, 'unsupported character for keycode typing: ' + repr(character))
        out.append((KEYCODES[lower], shifted))
    return out


def type_text_hid(electron_pid, text, bridge=None, guard_every=16):
    """Type through the ordinary HID path: real keycodes, guard re-checked while typing."""
    payload = keycodes_for(text)
    for index, (keycode, shifted) in enumerate(payload):
        if index % guard_every == 0:
            guard_frontmost(electron_pid, 'typing', bridge)
        send_unicode_keys(electron_pid, [], mode='global')  # keep the source warm per call
        flags = SHIFT if shifted else 0
        press_key(electron_pid, keycode, flags)


def window_shape(pid):
    """Window counts and layers for the owned process: the sheet stack is observable this way."""
    listing = owned_window_list(pid)
    return {'count': listing['count'],
            'layers': sorted(window['layer'] for window in listing['windows'])}


OWNED_PROCESS_NAME = 'Electron'


def system_events_key(keycode, flags=()):
    """Deliver a key to the owned process explicitly (System Events process targeting).

    A bare Electron process does not reliably hold keyboard focus, so a globally posted key can
    land in another application; targeting the process delivers it to that process's own queue.
    """
    # System Events takes every modifier in ONE using clause; repeated clauses are ignored,
    # which silently sent an unmodified key when command+shift were requested.
    suffix = ' using {%s down}' % ', '.join(flags) if flags else ''
    script = ('tell application "System Events" to tell process "%s" to key code %d%s'
              % (OWNED_PROCESS_NAME, keycode, suffix))
    completed = subprocess.run(['/usr/bin/osascript', '-e', script],
                               capture_output=True, text=True, timeout=30)
    time.sleep(0.15)
    return completed.returncode == 0


def system_events_type(text):
    """Type text into the owned process through System Events keystroke."""
    escaped = text.replace('\\', '\\\\').replace('"', '\\"')
    script = ('tell application "System Events" to tell process "%s" to keystroke "%s"'
              % (OWNED_PROCESS_NAME, escaped))
    completed = subprocess.run(['/usr/bin/osascript', '-e', script],
                               capture_output=True, text=True, timeout=60)
    time.sleep(0.3)
    return completed.returncode == 0


def activate_owned_app(pid):
    """Make the owned process the active application by PID (System Events, now permitted).

    A window can be topmost while another application still owns keyboard focus, which made
    globally posted keys land elsewhere. Setting frontmost by unix id removes that race.
    """
    script = ('tell application "System Events" to set frontmost of '
              '(first process whose unix id is %d) to true' % pid)
    completed = subprocess.run(['/usr/bin/osascript', '-e', script],
                               capture_output=True, text=True, timeout=30)
    time.sleep(0.6)
    return completed.returncode == 0


def clipboard_paste_into_panel(electron_pid, text, bridge):
    """Fill the go-to field by paste: the clipboard is saved and restored around the action.

    Typing per-character lands in the panel's file list (type-select HUD) when the field is
    not first responder, while a paste goes to whatever holds focus in the sheet.
    """
    saved = subprocess.run(['/usr/bin/pbpaste'], capture_output=True, timeout=30).stdout
    try:
        subprocess.run(['/usr/bin/pbcopy'], input=text.encode('utf-8'), timeout=30, check=True)
        guard_frontmost(electron_pid, 'paste', bridge)
        press_key(electron_pid, 9, SHIFT_FREE_COMMAND)  # cmd+V
        time.sleep(1.0)
    finally:
        subprocess.run(['/usr/bin/pbcopy'], input=saved, timeout=30)


def activate_owned_window(pid):
    """Click an inert corner of the owned main window so the app really holds keyboard focus.

    A window can be frontmost in the WindowServer while another app still owns keyboard focus;
    a real click on a point outside the sheet activates the app without touching panel content.
    """
    listing = owned_window_list(pid)
    main = max((window for window in listing['windows'] if window['layer'] == 0),
               key=lambda window: (window['bounds']['Width'] or 0) * (window['bounds']['Height'] or 0),
               default=None)
    need(main is not None, 'the owned process has no layer-0 window to activate')
    bounds = main['bounds']
    x = int(bounds['X'] + 20)
    y = int(bounds['Y'] + (bounds['Height'] or 0) - 20)
    core_graphics = ctypes_load_coregraphics()
    core_foundation = ctypes.cdll.LoadLibrary(ctypes.util.find_library('CoreFoundation'))
    core_graphics.CGEventCreateMouseEvent.restype = ctypes.c_void_p
    core_graphics.CGEventCreateMouseEvent.argtypes = [
        ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32]
    core_graphics.CGEventPost.restype = None
    core_graphics.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
    core_foundation.CFRelease.argtypes = [ctypes.c_void_p]

    class Point(ctypes.Structure):
        _fields_ = [('x', ctypes.c_double), ('y', ctypes.c_double)]

    point = Point(float(x), float(y))
    for kind in (1, 2, 3):  # leftMouseDown=1, leftMouseUp=2, leftMouseDragged=6; use down/up
        if kind == 3:
            continue
        event = core_graphics.CGEventCreateMouseEvent(None, kind, ctypes.byref(point), 0)
        need(event, 'the synthetic click event was not created')
        core_graphics.CGEventPost(0, event)
        core_foundation.CFRelease(event)
        time.sleep(0.05)
    time.sleep(0.6)


def close_panel_with_escape(electron_pid, baseline_windows, bridge, attempts=3, wait=8):
    """Escape may first clear the panel's search field, so press until the sheet closes."""
    trace = []
    for attempt in range(1, attempts + 1):
        activated = activate_owned_app(electron_pid)
        front_after_activate = frontmost_normal_pid()
        guard_frontmost(electron_pid, 'escape-%d' % attempt, bridge)
        # A native sheet only accepts the ordinary HID path; PID-directed keys reach the
        # renderer but not AppKit, and the guard above bounds where the global key can land.
        system_events_key(53)
        deadline = time.monotonic() + wait
        closed = False
        while time.monotonic() < deadline:
            if owned_window_list(electron_pid)['count'] <= baseline_windows:
                closed = True
                break
            time.sleep(0.5)
        trace.append({'attempt': attempt, 'activated': activated, 'frontAfterActivate': front_after_activate,
                      'closed': closed, 'windows': owned_window_list(electron_pid)['count']})
        LAST['escape-trace'] = trace
        if closed:
            return {'presses': attempt, 'mode': 'global'}
            time.sleep(0.5)
    return None


def panel_round(profile, evidence, checks, observations, fixtures, bridge, guards, electron_pid, read,
                interact=False, target=None):
    """Open the real NSOpenPanel through the original entry and observe it via the WindowServer.

    The panel's own interaction (GoTo path input, allow/deny/cancel) needs Accessibility and
    stays out of scope here; this records only that the original entry really opens it.
    """
    before = owned_window_list(electron_pid)
    observations['windowsBefore'] = {'count': before['count'], 'windows': before['windows']}
    entry = wait_for(read, lambda v: v['attachButton'], 30, 'composer attachment button')
    harness.click_point(bridge, entry['attachButton'])
    menu = wait_for(read, lambda v: v['attachItem'], 30, 'composer attachment menu item')
    observations['attachMenuItem'] = menu['attachItemText']
    checks.append('original-composer-exposed-the-attachment-entry')
    harness.click_point(bridge, menu['attachItem'])

    signature = lambda window: json.dumps(
        [window['ownerPid'], window['windowName'], window['bounds']], sort_keys=True)
    known = {signature(window) for window in before['windows']}
    opened = None
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        current = owned_window_list(electron_pid)
        extra = [window for window in current['windows'] if signature(window) not in known]
        if current['count'] > before['count'] or extra:
            opened = {'count': current['count'], 'windows': current['windows'], 'extra': extra}
            break
        time.sleep(0.5)
    LAST['panel-open'] = opened
    need(opened is not None, 'the original entry did not open a new owned window')
    observations['windowsAfter'] = opened
    checks.append('original-entry-opened-a-real-system-panel-owned-by-the-app')

    if interact:
        ax_trusted = ax_driver.trusted()
        granted = post_event_access()
        observations['accessibility'] = {'axTrusted': ax_trusted, 'syntheticKeyAccess': granted}
        checks.append('checked-the-accessibility-grant-before-any-panel-action')
        if not (ax_trusted or granted):
            # No panel input is attempted: the grant that governs both AX actions and synthetic
            # key delivery is absent.
            LAST['panel-interaction-blocked'] = {'granted': False, 'panelWindows': opened['count'],
                                                 'frontmostNormalPid': frontmost_normal_pid()}
            observations['panelInteraction'] = {'attempted': False, 'reason': 'accessibility not granted',
                                                'frontmostNormalPid': frontmost_normal_pid()}
            fixtures.send({'op': 'stopNative'})
            time.sleep(3)
            remaining = owned_window_list(electron_pid)
            observations['windowsAfterTeardown'] = {'count': remaining['count']}
            need(remaining['count'] == 0, 'the owned process still shows a window after teardown')
            checks.append('panel-torn-down-with-its-owned-process')
            return finish(profile, evidence, checks, observations, fixtures, bridge, guards, 'blocked')

        journal = []
        observations['axJournal'] = journal
        front = frontmost_visible()
        foreign = [window for window in visible_windows()['windows'] if window['ownerPid'] != electron_pid]
        observations['screenAtPanelStart'] = {'ownedPid': electron_pid, 'frontmost': front,
                                              'foreignVisible': foreign[:10],
                                              'foreignCount': len(foreign)}

        # Close the panel opened for the evidence above: every case below opens its own.
        panel_bounds = (opened['extra'] or [{'bounds': None}])[0]['bounds']
        panel_ref, panel_info, panel_nodes, panel_refs = ax_locate(electron_pid, panel_bounds)
        observations['axPanel'] = {'found': panel_ref is not None, 'element': ax_node_label(panel_info),
                                   'controls': ax_controls(panel_nodes)}
        LAST['ax-panel-tree'] = write_ax_evidence(evidence, 'ax-tree-panel', panel_nodes)
        dismissal = dismiss_panel(electron_pid, panel_nodes, before['count'], bridge, journal)
        ax_release([ref for ref, _ in panel_nodes])
        ax_release(panel_refs)
        LAST['dismissed-open-panel'] = dismissal
        need(dismissal['closed'], 'the panel opened for evidence could not be dismissed')
        checks.append('dismissed-the-panel-before-the-outcome-matrix')

        outcomes = []
        for case in ('cancel', 'deny', 'allow'):
            if case == 'allow':
                fixtures.command('configure', 60, kind='security', data={'allowFilesystem': True})
            elif case == 'deny':
                fixtures.command('configure', 60, kind='security', data={'allowFilesystem': False})
            before_case = owned_window_list(electron_pid)
            reopen_panel(bridge, guards, read)
            opened_case = wait_extra_window(electron_pid, before_case, 20, case + ' panel window')
            need(opened_case is not None, case + ': the panel window never appeared')
            case_bounds = opened_case['extra'][0]['bounds']
            panel_ref, panel_info, panel_nodes, panel_refs = ax_locate(electron_pid, case_bounds)
            journal.append({'step': 'locate-panel', 'case': case, 'found': panel_ref is not None,
                            'element': ax_node_label(panel_info), 'controls': ax_controls(panel_nodes)})
            try:
                if case == 'cancel':
                    dismissal = dismiss_panel(electron_pid, panel_nodes, before_case['count'],
                                              bridge, journal)
                    LAST['cancel-escape'] = dismissal
                    need(dismissal['closed'], 'the panel did not close in the cancel case')
                else:
                    navigation = navigate_panel_to_folder(electron_pid, panel_ref, target,
                                                          before_case['count'], bridge, journal)
                    LAST[case + '-navigate'] = navigation
                    need(navigation['reached'],
                         case + ': the panel never reached the target folder')
                    checks.append('panel-navigated-to-the-target-folder-' + navigation['route'])
                    rows, row = panel_rows(panel_ref, target.name)
                    journal.append({'step': 'locate-row', 'case': case, 'found': row is not None,
                                    'element': ax_node_label(row[1]) if row else None})
                    need(row is not None, case + ': the target file is not listed in the panel')
                    row_ref, row_info = row
                    if case == 'deny':
                        LAST['ax-panel-tree-in-folder'] = write_ax_evidence(
                            evidence, 'ax-tree-panel-folder', rows)
                    select_row(electron_pid, row_ref, row_info, before_case['count'], journal, case)
                    ax_release([ref for ref, _ in rows])
                    if owned_window_list(electron_pid)['count'] <= before_case['count']:
                        journal.append({'step': 'panel-closed', 'mode': 'row-action'})
                    else:
                        accepted = accept_panel(electron_pid, panel_nodes, before_case['count'],
                                                bridge, journal)
                        LAST[case + '-accept'] = accepted
                        need(accepted is not None,
                             case + ': the panel never returned a selection')
            finally:
                ax_release([ref for ref, _ in panel_nodes])
                ax_release(panel_refs)
            state = wait_for(read, lambda v: True, 8, case + ' settle')
            after_case = owned_window_list(electron_pid)
            panel_closed = after_case['count'] <= before_case['count']
            outcomes.append({'case': case, 'chipCount': state['chipCount'], 'panelClosed': panel_closed,
                             'windowsBefore': before_case['count'], 'windowsAfter': after_case['count'],
                             'windowsAfterList': after_case['windows']})
            LAST['case-' + case] = outcomes[-1]
            if case == 'cancel':
                need(state['chipCount'] == 0 and panel_closed,
                     'cancelling the panel must leave no attachment and close it')
                checks.append('panel-cancel-left-no-attachment-and-closed-the-panel')
                continue
            need(state['chipCount'] == 1 and panel_closed,
                 case + ': the panel did not hand one attachment to the pipeline')
            checks.append('panel-go-to-path-input-produced-one-attachment-' + case)
            harness.click_point(bridge, read()['composerPoint'])
            bridge.raw_cdp('Input.insertText', text='NATIVE_PANEL_' + case.upper() + '_TURN')
            wait_for(read, lambda v: 'NATIVE_PANEL_' + case.upper() + '_TURN' in (v['composerText'] or ''), 20,
                     case + ' prompt text')
            harness.click_point(bridge, read()['sendPoint'])
            time.sleep(12)
            requests = model_requests(fixtures, evidence, 'panel-' + case)
            hits = contains_marker(requests, ALLOW_MARKER)
            outcomes[-1]['markerRequests'] = hits
            if case == 'allow':
                need(hits, 'the panel-picked attachment body never reached a model request')
                checks.append('panel-picked-attachment-body-delivered-under-the-allowing-policy')
            else:
                need(not hits, 'the panel-picked attachment body reached a model request while revoked')
                checks.append('panel-picked-attachment-body-withheld-under-the-revoked-policy')
        observations['panelInteraction'] = {'attempted': True, 'outcomes': outcomes}


    # Teardown closes the panel with its process; nothing is left on screen.
    fixtures.send({'op': 'stopNative'})
    time.sleep(3)
    remaining = owned_window_list(electron_pid)
    observations['windowsAfterTeardown'] = {'count': remaining['count']}
    need(remaining['count'] == 0, 'the owned process still shows a window after teardown')
    checks.append('panel-torn-down-with-its-owned-process')
    return finish(profile, evidence, checks, observations, fixtures, bridge, guards, 'passed')



def click_point_global(x, y):
    """One real click at a screen point through the ordinary HID path.

    Kept only for the input-replay phase, which reproduces the pre-AX guessed-point click that
    the panel rounds no longer make: the whole point of that replay is to re-post exactly what
    the reported "shutdown screen" run posted.
    """
    core_graphics = ctypes_load_coregraphics()
    core_foundation = ctypes.cdll.LoadLibrary(ctypes.util.find_library('CoreFoundation'))
    core_graphics.CGEventCreateMouseEvent.restype = ctypes.c_void_p
    core_graphics.CGEventCreateMouseEvent.argtypes = [
        ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32]
    core_graphics.CGEventPost.restype = None
    core_graphics.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
    core_foundation.CFRelease.argtypes = [ctypes.c_void_p]

    class Point(ctypes.Structure):
        _fields_ = [('x', ctypes.c_double), ('y', ctypes.c_double)]

    point = Point(float(x), float(y))
    for kind in (1, 2):
        event = core_graphics.CGEventCreateMouseEvent(None, kind, ctypes.byref(point), 0)
        need(event, 'the synthetic click event was not created')
        core_graphics.CGEventPost(0, event)
        core_foundation.CFRelease(event)
        time.sleep(0.05)
    time.sleep(0.5)


SYSTEM_UI_OWNERS = {'Window Server', 'loginwindow', 'SecurityAgent', 'CoreServicesUIAgent',
                    'UserNotificationCenter', '通知中心', 'SystemUIServer', 'ControlCenter', '程序坞'}


def screen_signature(window):
    return json.dumps([window['ownerPid'], window['ownerName'], window['layer'], window['bounds']],
                      sort_keys=True)


def sample_screen(samples, baseline, electron_pid, label):
    """One screen sample: frontmost window, foreign owners, and any window that is not ours.

    Windows present at baseline (for example the user's own applications) are kept as owners
    only; anything that appears later is recorded in full so a dialog cannot hide in the noise.
    """
    visible = visible_windows()['windows']
    front = frontmost_visible()
    fresh = [window for window in visible
             if screen_signature(window) not in baseline and window['ownerPid'] != electron_pid]
    system_ui = [window for window in visible if window['ownerName'] in SYSTEM_UI_OWNERS]
    samples.append({'label': label,
                    'frontmost': [front['frontmostPid'], front['frontmostName'], front['frontmostLayer']],
                    'foreignOwners': sorted({window['ownerName'] for window in visible
                                             if window['ownerPid'] != electron_pid}),
                    'newNonOwned': fresh, 'systemUiWindows': system_ui})
    return samples[-1]


def input_replay(profile, evidence, checks, observations, fixtures, bridge, guards, electron_pid, read,
                 target):
    """Replay the pre-AX input sequence while sampling the screen for any system UI.

    The reported shutdown screen is absent from the system logs, so this replays exactly the
    input the earlier run posted (guarded global Cmd+Shift+G, the old guessed-point click inside
    the panel, System Events typing and Escape/Return/Tab/Space) and samples every visible window
    above layer 0 after each batch. Any window that appears and is not ours is recorded in full.
    """
    baseline = {screen_signature(window) for window in visible_windows()['windows']}
    samples = []
    observations['inputReplayBaseline'] = {'ownedPid': electron_pid,
                                           'windows': visible_windows()['windows']}

    before = owned_window_list(electron_pid)
    entry = wait_for(read, lambda v: v['attachButton'], 30, 'composer attachment button')
    harness.click_point(bridge, entry['attachButton'])
    menu = wait_for(read, lambda v: v['attachItem'], 30, 'composer attachment menu item')
    harness.click_point(bridge, menu['attachItem'])
    opened = wait_extra_window(electron_pid, before, 30, 'panel window for the replay')
    need(opened is not None, 'the original entry did not open a panel for the replay')
    checks.append('original-entry-opened-the-panel-for-the-replay')
    sample_screen(samples, baseline, electron_pid, 'panel-open')

    panel_bounds = opened['extra'][0]['bounds']
    activate_owned_app(electron_pid)
    guard_frontmost(electron_pid, 'replay:activate', bridge)
    sample_screen(samples, baseline, electron_pid, 'activated')

    # The pre-AX routes: PID-directed first (it never reached AppKit), then the guarded global post.
    send_unicode_keys(electron_pid, ['cmd+shift+g'])
    time.sleep(1.5)
    sample_screen(samples, baseline, electron_pid, 'pid-directed-go-to')
    guard_frontmost(electron_pid, 'replay:go-to', bridge)
    send_unicode_keys(electron_pid, ['cmd+shift+g'], mode='global')
    time.sleep(2.0)
    checks.append('replayed-the-guarded-global-go-to-key')
    sample_screen(samples, baseline, electron_pid, 'global-go-to')

    # The old blind click at the sheet-guess point, then the old commit strategy.
    click_point_global(int(panel_bounds['X'] + 120), int(panel_bounds['Y'] + 40))
    sample_screen(samples, baseline, electron_pid, 'guessed-point-click')
    guard_frontmost(electron_pid, 'replay:type', bridge)
    system_events_type(str(target))
    time.sleep(1.0)
    sample_screen(samples, baseline, electron_pid, 'path-typed')
    for keys in ([36], [53, 36], [48, 49], [48, 49]):
        guard_frontmost(electron_pid, 'replay:commit', bridge)
        for keycode in keys:
            system_events_key(keycode)
        time.sleep(1.5)
        sample_screen(samples, baseline, electron_pid, 'commit-' + '-'.join(str(k) for k in keys))
    for label, keys in (('escape-1', (53,)), ('escape-2', (53,))):
        guard_frontmost(electron_pid, 'replay:' + label, bridge)
        for keycode in keys:
            system_events_key(keycode)
        time.sleep(1.5)
        sample_screen(samples, baseline, electron_pid, label)
    time.sleep(2.0)
    sample_screen(samples, baseline, electron_pid, 'quiet')

    suspicious = [sample for sample in samples
                  if sample['newNonOwned'] or sample['systemUiWindows']]
    observations['inputReplaySamples'] = samples
    observations['inputReplaySuspicious'] = suspicious
    observations['inputReplayFrontmostOwn'] = all(
        sample['frontmost'][0] == electron_pid or sample['frontmost'][0] is None for sample in samples)
    if suspicious:
        checks.append('replay-saw-a-window-that-was-not-ours')
        return finish(profile, evidence, checks, observations, fixtures, bridge, guards, 'failed')
    checks.append('replay-saw-no-system-window-above-layer-0')
    return finish(profile, evidence, checks, observations, fixtures, bridge, guards, 'passed')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile', default='client-native-g07e-probe-20261019')
    parser.add_argument('--phase', default='consumption',
                        choices=('consumption', 'panel', 'panel-interaction', 'key-probe',
                                 'input-replay'))
    arguments = parser.parse_args()
    profile = arguments.profile
    need(re.fullmatch(r'client-native-[a-z0-9-]+', profile), 'bad profile name')

    root, evidence = REPO / 'data' / profile, REPO / 'evidence' / profile
    for path in (root, evidence):
        shutil.rmtree(path, ignore_errors=True)
    (evidence / 'controller-home').mkdir(parents=True, mode=0o700)
    (evidence / 'controller-tmp').mkdir(parents=True, mode=0o700)

    first = harness.runpy.run_path(str(REPO / 'scripts/fixtures/native-first-run-ui.py'))
    fixtures = bridge = guards = None
    checks, observations, error = [], {}, None
    try:
        fixtures = harness.Fixture(profile, evidence / 'controller-home',
                                   evidence / 'controller-tmp', mode='experience')
        fixtures.wait_event(lambda e: e.get('event') == 'ready', 240, 'ready')
        fixtures.send({'op': 'launch'})
        launched = fixtures.wait_event(lambda e: e.get('event') == 'launched', 120, 'launched')
        bridge = harness.Bridge(launched['cdpPort'],
                                (root / 'runtime/app/out/renderer/index.html').as_uri())
        guards = harness.Guards(evidence)
        checks.append('owned-main-renderer-attached-over-loopback-cdp')

        first_run = first['FirstRunUi'](
            'file-restored', lambda expression: bridge.evaluate(expression),
            bridge.raw_cdp, guards.guard, guards.budget, guards.claim, guards.auth_started)
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            value = first_run.phase('observe')
            if not value['startupLoadingVisible'] and (
                    value['onboardingVisible'] or value['ready'] or value['loginVisible']):
                break
            time.sleep(0.5)
        workspace = root / 'project-g07e'
        workspace.mkdir(parents=True, mode=0o700)
        subprocess.run(['/usr/bin/git', 'init', '--quiet', str(workspace)], check=True)
        fixtures.command('openWorkspace', 60, workspacePath=str(workspace))
        for _ in range(20):
            state = first_run.phase('observe')
            if state['ready']:
                break
            step = state['step']
            if step == 'role':
                first_run.phase('select_developer' if not state['developerSelected'] else 'next_role')
            elif step == 'mode':
                first_run.phase('select_coding' if not state['codingSelected'] else 'next_mode')
            elif step == 'preferences':
                first_run.phase('finish')
            else:
                time.sleep(0.5)
        need(first_run.phase('observe')['ready'], 'the workspace never became ready')
        checks.append('original-first-run-and-owned-workspace-ready')

        files = {
            ('text', 'allow'): workspace / 'attachment-allow.txt',
            ('text', 'deny'): workspace / 'attachment-deny.txt',
            ('image', 'allow'): workspace / 'attachment-allow.png',
            ('image', 'deny'): workspace / 'attachment-deny.png',
            ('pdf', 'allow'): workspace / 'attachment-allow.pdf',
            ('pdf', 'deny'): workspace / 'attachment-deny.pdf',
            ('video', 'allow'): workspace / 'attachment-allow.mp4',
            ('video', 'deny'): workspace / 'attachment-deny.mp4',
        }
        files[('text', 'allow')].write_text(ALLOW_MARKER + '\n', encoding='utf-8')
        files[('text', 'deny')].write_text(DENY_MARKER + '\n', encoding='utf-8')
        for key in (('image', 'allow'), ('image', 'deny')):
            files[key].write_bytes(base64.b64decode(TINY_PNG_B64))
        files[('pdf', 'allow')].write_bytes(minimal_pdf('PDF_ALLOW'))
        files[('pdf', 'deny')].write_bytes(minimal_pdf('PDF_DENY'))
        for key, colour in ((('video', 'allow'), 'black'), (('video', 'deny'), 'white')):
            write_tiny_video(files[key], colour)

        read = lambda: project(bridge)
        wait_for(read, lambda v: v['composerPoint'] and v['sendPoint'], 40, 'composer ready')
        need(read()['fileInputCount'] == 1, 'the composer file input was not uniquely mounted')

        if arguments.phase == 'key-probe':
            return key_probe(profile, evidence, checks, observations, fixtures, bridge, guards,
                             launched['pid'], read)

        if arguments.phase == 'input-replay':
            return input_replay(profile, evidence, checks, observations, fixtures, bridge, guards,
                               launched['pid'], read, files[('text', 'allow')])

        if arguments.phase in ('panel', 'panel-interaction'):
            return panel_round(profile, evidence, checks, observations, fixtures, bridge, guards,
                               launched['pid'], read,
                               interact=arguments.phase == 'panel-interaction',
                               target=files[('text', 'allow')])

        markers = {('text', 'allow'): ALLOW_MARKER, ('text', 'deny'): DENY_MARKER}
        rounds = [('text', 'allow'), ('image', 'allow'), ('video', 'allow'), ('pdf', 'allow'),
                  ('text', 'deny'), ('image', 'deny'), ('video', 'deny'), ('pdf', 'deny')]
        current_policy = None
        for kind, state in rounds:
            allowed = state == 'allow'
            label, path = kind + '-' + state, files[(kind, state)]
            if current_policy is not allowed:
                fixtures.command('configure', 60, kind='security', data={'allowFilesystem': allowed})
                current_policy = allowed
                checks.append('published-current-security-policy-'
                              + ('allowing' if allowed else 'revoking') + '-filesystem')
            wait_for(read, lambda v: v['composerPoint'] and v['sendPoint'], 30, 'composer before ' + label)
            feed_file(bridge, path)
            chipped = wait_for(read, lambda v: v['chipCount'] == 1, 40, label + ' attachment chip')
            harness.click_point(bridge, chipped['composerPoint'])
            token = 'NATIVE_ATTACHMENT_' + label.upper().replace('-', '_') + '_TURN'
            bridge.raw_cdp('Input.insertText', text=token)
            wait_for(read, lambda v: token in (v['composerText'] or ''), 20, label + ' prompt text')
            harness.click_point(bridge, read()['sendPoint'])
            time.sleep(13)

            requests = model_requests(fixtures, evidence, label)
            blobs = [json.dumps(body, ensure_ascii=False) for body in requests]
            reference, payload = str(path), payload_prefix(path)
            hits = {
                'reference': [i for i, text in enumerate(blobs) if reference in text],
                'payload': [i for i, text in enumerate(blobs) if payload and payload in text],
            }
            # Only the message that carries this round's own attachment may be judged: the
            # request history still holds earlier rounds' notes.
            own_body = requests[hits['reference'][0]] if hits['reference'] else None
            own_messages = [json.dumps(message, ensure_ascii=False)
                            for message in (own_body or {}).get('messages', [])]
            carrying = [message for message in own_messages if reference in message]
            own = carrying[0] if carrying else (blobs[hits['reference'][0]] if hits['reference'] else blobs[-1])
            hits['notes'] = extra_lines(own)
            hits['carriedByOwnMessage'] = bool(carrying)
            # The round's request still carries earlier turns, so the media note must name
            # this round's own file to count.
            hits['mediaNote'] = [line for line in hits['notes']
                                 if line.startswith(('[Image: source:', '[Video: source:', '[PDF: source:'))
                                 and reference in line]
            # A media block the selected model cannot accept is dropped before it gets a derived
            # source note, so that omission note is the evidence the branch ran for this round.
            hits['omitted'] = (OMMISSION[kind] in own) if kind in OMMISSION else None
            if (kind, state) in markers:
                hits['body'] = contains_marker(requests, markers[(kind, state)])
            observations[label] = {'allowed': allowed, 'requests': len(requests), 'hits': hits,
                                   'chipText': chipped['chips'][0]['text'] if chipped['chips'] else None}

            if allowed:
                need(hits['reference'], label + ': the allowed attachment never reached a model request')
                checks.append('allowed-filesystem-' + kind + '-attachment-reached-the-model')
                if 'body' in hits:
                    need(hits['body'], label + ': the allowed text body never reached a model request')
                    checks.append('allowed-filesystem-text-attachment-body-delivered')
                if kind in OMMISSION:
                    need(hits['mediaNote'] or hits['omitted'],
                         label + ': the allowed media never went through the media branch')
                    checks.append('allowed-filesystem-' + kind + '-media-branch-processed-the-file')
            else:
                # A revoked attachment may still be named by the original placeholder semantics,
                # but neither its body nor its media payload may be consumed.
                need(not hits['payload'],
                     label + ': the revoked attachment payload still reached a model request')
                if 'body' in hits:
                    need(not hits['body'], label + ': the revoked text body still reached a model request')
                if kind in OMMISSION:
                    need(not hits['mediaNote'] and not hits['omitted'],
                         label + ': the revoked media still went through the media branch')
                    checks.append('revoked-filesystem-' + kind + '-media-branch-did-not-process-the-file')
                checks.append('revoked-filesystem-' + kind + '-attachment-consumed-no-body')

        return finish(profile, evidence, checks, observations, fixtures, bridge, guards, 'passed')
    except Exception as caught:
        error = caught
        return finish(profile, evidence, checks, observations, fixtures, bridge, guards, 'failed', caught)


def finish(profile, evidence, checks, observations, fixtures, bridge, guards, status, error=None):
    payload = dict(schema='g07e-native-cdp-probe-v1', status=status, profile=profile,
                   boundary='real native fixture (isolated backend, real Electron/Host, original composer and '
                            'local-path attachment pipeline); consumption rounds feed files through the composer file '
                            'input via CDP, the panel rounds pick the file in the real NSOpenPanel through '
                            'Accessibility element actions; not the reviewed Go/actor ceremony',
                   checks=checks, observations=observations,
                   actions=guards.journal() if guards else [], lastObservations=LAST)
    if error is not None:
        payload['failure'] = type(error).__name__ + ': ' + str(error)[:300]
        payload['failureCode'] = getattr(error, 'code', None)
    try:
        if fixtures:
            fixtures.send({'op': 'stopNative'})
    except Exception:
        pass
    time.sleep(2)
    for child in (bridge, fixtures.child if fixtures else None):
        if child:
            try:
                child.kill()
            except Exception:
                pass
    evidence.mkdir(parents=True, exist_ok=True)
    (evidence / 'probe-result.json').write_text(json.dumps(payload, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    os.chmod(evidence / 'probe-result.json', 0o600)
    print(json.dumps({k: payload[k] for k in payload if k not in ('observations', 'lastObservations')},
                     ensure_ascii=False, indent=1))
    print('OBSERVATIONS', json.dumps(payload.get('observations', {}), ensure_ascii=False)[:1500])
    return 0 if status == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
