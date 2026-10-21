#!/usr/bin/env python3
"""Accessibility (AX) projection of one process: bounded tree dumps and element-scoped actions.

Every action (press, set value, confirm) is delivered to the resolved element itself, so nothing
is posted to the desktop: no synthetic key lands in another application and no blind click hits a
screen coordinate. Requires the Accessibility permission (AXIsProcessTrusted()).

CLI (read-only dump, used to learn a panel's structure):

    python3 macos-ax-driver.py <pid> dump [--max-depth N] [--max-nodes N]
"""
import ctypes as C
import ctypes.util
import json
import sys

_CF = C.cdll.LoadLibrary(ctypes.util.find_library('CoreFoundation'))
_AX = C.cdll.LoadLibrary(
    '/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices')

CFTypeRef = C.c_void_p
CFStringRef = C.c_void_p
CFArrayRef = C.c_void_p
CFAllocatorRef = C.c_void_p
AXUIElementRef = C.c_void_p

_CF.CFStringCreateWithCString.restype = CFStringRef
_CF.CFStringCreateWithCString.argtypes = [CFAllocatorRef, C.c_char_p, C.c_uint32]
_CF.CFStringGetCString.restype = C.c_bool
_CF.CFStringGetCString.argtypes = [CFStringRef, C.c_char_p, C.c_long, C.c_uint32]
_CF.CFGetTypeID.restype = C.c_ulong
_CF.CFGetTypeID.argtypes = [CFTypeRef]
_CF.CFStringGetTypeID.restype = C.c_ulong
_CF.CFArrayGetTypeID.restype = C.c_ulong
_CF.CFNumberGetTypeID.restype = C.c_ulong
_CF.CFBooleanGetTypeID.restype = C.c_ulong
_CF.CFArrayGetCount.restype = C.c_long
_CF.CFArrayGetCount.argtypes = [CFArrayRef]
_CF.CFArrayGetValueAtIndex.restype = CFTypeRef
_CF.CFArrayGetValueAtIndex.argtypes = [CFArrayRef, C.c_long]
_CF.CFNumberGetValue.restype = C.c_bool
_CF.CFNumberGetValue.argtypes = [CFTypeRef, C.c_long, C.c_void_p]
_CF.CFBooleanGetValue.restype = C.c_bool
_CF.CFBooleanGetValue.argtypes = [CFTypeRef]
_CF.CFRelease.restype = None
_CF.CFRelease.argtypes = [CFTypeRef]
_CF.CFRetain.restype = CFTypeRef
_CF.CFRetain.argtypes = [CFTypeRef]

_AX.AXUIElementCreateApplication.restype = AXUIElementRef
_AX.AXUIElementCreateApplication.argtypes = [C.c_int]
_AX.AXUIElementCreateSystemWide.restype = AXUIElementRef
_AX.AXUIElementCopyAttributeValue.restype = C.c_int32
_AX.AXUIElementCopyAttributeValue.argtypes = [AXUIElementRef, CFStringRef, C.POINTER(CFTypeRef)]
_AX.AXUIElementSetAttributeValue.restype = C.c_int32
_AX.AXUIElementSetAttributeValue.argtypes = [AXUIElementRef, CFStringRef, CFTypeRef]
_AX.AXUIElementIsAttributeSettable.restype = C.c_int32
_AX.AXUIElementIsAttributeSettable.argtypes = [AXUIElementRef, CFStringRef, C.POINTER(C.c_bool)]
_AX.AXUIElementPerformAction.restype = C.c_int32
_AX.AXUIElementPerformAction.argtypes = [AXUIElementRef, CFStringRef]
_AX.AXUIElementCopyActionNames.restype = C.c_int32
_AX.AXUIElementCopyActionNames.argtypes = [AXUIElementRef, C.POINTER(CFArrayRef)]
_AX.AXUIElementCopyAttributeNames.restype = C.c_int32
_AX.AXUIElementCopyAttributeNames.argtypes = [AXUIElementRef, C.POINTER(CFArrayRef)]
_AX.AXUIElementCopyElementAtPosition.restype = C.c_int32
_AX.AXUIElementCopyElementAtPosition.argtypes = [AXUIElementRef, C.c_float, C.c_float,
                                                C.POINTER(AXUIElementRef)]
_AX.AXValueGetValue.restype = C.c_bool
_AX.AXValueGetValue.argtypes = [CFTypeRef, C.c_int32, C.c_void_p]
_AX.AXIsProcessTrusted.restype = C.c_bool

K_CF_STRING_ENCODING_UTF8 = 0x08000100
K_CF_NUMBER_DOUBLE = 13
K_AX_VALUE_CG_POINT = 1
K_AX_VALUE_CG_SIZE = 2

ROLE = 'AXRole'
SUBROLE = 'AXSubrole'
TITLE = 'AXTitle'
VALUE = 'AXValue'
PLACEHOLDER = 'AXPlaceholderValue'
DESCRIPTION = 'AXDescription'
IDENTIFIER = 'AXIdentifier'
ENABLED = 'AXEnabled'
FOCUSED = 'AXFocused'
CHILDREN = 'AXChildren'
WINDOWS = 'AXWindows'
SHEETS = 'AXSheets'
POSITION = 'AXPosition'
SIZE = 'AXSize'

PRESS = 'AXPress'
CONFIRM = 'AXConfirm'
CANCEL = 'AXCancel'
SHOW_MENU = 'AXShowMenu'
PICK = 'AXPick'

ERRORS = {
    0: 'success', -25200: 'failure', -25201: 'illegal-argument', -25202: 'invalid-ui-element',
    -25203: 'invalid-ui-element-observer', -25204: 'cannot-complete',
    -25205: 'attribute-unsupported', -25206: 'action-unsupported',
    -25207: 'notification-unsupported', -25208: 'not-implemented',
    -25209: 'notification-already-registered', -25210: 'notification-not-registered',
    -25211: 'api-disabled (Accessibility not granted)', -25212: 'no-value',
    -25213: 'parameterized-attribute-unsupported', -25214: 'not-enough-precision',
}


def error_name(code):
    return ERRORS.get(code, 'code ' + str(code))


class CGPoint(C.Structure):
    _fields_ = [('x', C.c_double), ('y', C.c_double)]


class CGSize(C.Structure):
    _fields_ = [('width', C.c_double), ('height', C.c_double)]


def trusted():
    return bool(_AX.AXIsProcessTrusted())


def release(target):
    """Release an owned AX/CF reference."""
    _CF.CFRelease(target)


def _cf_string(text):
    return _CF.CFStringCreateWithCString(None, str(text).encode('utf-8'), K_CF_STRING_ENCODING_UTF8)


def _python_value(obj, limit=200):
    """CFTypeRef to a JSON-safe python value; AX values can be long, so they are bounded."""
    if not obj:
        return None
    type_id = _CF.CFGetTypeID(obj)
    if type_id == _CF.CFStringGetTypeID():
        buffer = C.create_string_buffer(8192)
        if not _CF.CFStringGetCString(obj, buffer, 8192, K_CF_STRING_ENCODING_UTF8):
            return None
        text = buffer.value.decode('utf-8', 'replace')
        return text[:limit] + ('…' if len(text) > limit else '')
    if type_id == _CF.CFNumberGetTypeID():
        out = C.c_double(0)
        if not _CF.CFNumberGetValue(obj, K_CF_NUMBER_DOUBLE, C.byref(out)):
            return None
        return out.value
    if type_id == _CF.CFBooleanGetTypeID():
        return bool(_CF.CFBooleanGetValue(obj))
    if type_id == _CF.CFArrayGetTypeID():
        return [_python_value(_CF.CFArrayGetValueAtIndex(obj, index), limit)
                for index in range(min(_CF.CFArrayGetCount(obj), 64))]
    return '<cf-type-%d>' % type_id


def element(pid):
    return _AX.AXUIElementCreateApplication(pid)


def system_wide():
    return _AX.AXUIElementCreateSystemWide()


def attribute(target, name):
    """(value, error_code) for one AX attribute; the value is released before returning."""
    out = CFTypeRef()
    code = _AX.AXUIElementCopyAttributeValue(target, _cf_string(name), C.byref(out))
    if code != 0 or not out:
        return None, code
    try:
        return _python_value(out), 0
    finally:
        _CF.CFRelease(out)


def attribute_element(target, name):
    """The raw AX element held by an attribute (AXWindows/AXChildren/AXSheets), retained."""
    out = CFTypeRef()
    code = _AX.AXUIElementCopyAttributeValue(target, _cf_string(name), C.byref(out))
    if code != 0 or not out:
        return None, code
    return out, 0


def action_names(target):
    out = CFArrayRef()
    if _AX.AXUIElementCopyActionNames(target, C.byref(out)) != 0 or not out:
        return []
    try:
        return _python_value(out) or []
    finally:
        _CF.CFRelease(out)


def attribute_names(target):
    out = CFArrayRef()
    if _AX.AXUIElementCopyAttributeNames(target, C.byref(out)) != 0 or not out:
        return []
    try:
        return _python_value(out) or []
    finally:
        _CF.CFRelease(out)


def settable(target, name):
    out = C.c_bool(False)
    code = _AX.AXUIElementIsAttributeSettable(target, _cf_string(name), C.byref(out))
    return bool(out.value), code


def set_value(target, name, text):
    return _AX.AXUIElementSetAttributeValue(target, _cf_string(name), _cf_string(text))


def perform(target, action):
    return _AX.AXUIElementPerformAction(target, _cf_string(action))


def element_at(x, y):
    """The AX element under a screen point (resolution, not a click)."""
    out = AXUIElementRef()
    code = _AX.AXUIElementCopyElementAtPosition(system_wide(), float(x), float(y), C.byref(out))
    if code != 0 or not out:
        return None, code
    return out, 0


def frame(target):
    position, _ = attribute_element(target, POSITION)
    size, _ = attribute_element(target, SIZE)
    point, dimension = CGPoint(), CGSize()
    has_point = bool(position) and _AX.AXValueGetValue(position, K_AX_VALUE_CG_POINT, C.byref(point))
    has_size = bool(size) and _AX.AXValueGetValue(size, K_AX_VALUE_CG_SIZE, C.byref(dimension))
    for raw in (position, size):
        if raw:
            _CF.CFRelease(raw)
    if not (has_point and has_size):
        return None
    return {'X': point.x, 'Y': point.y, 'Width': dimension.width, 'Height': dimension.height}


def describe(target, depth=0):
    info = {'depth': depth}
    for key, name in (('role', ROLE), ('subrole', SUBROLE), ('title', TITLE), ('value', VALUE),
                      ('placeholder', PLACEHOLDER), ('description', DESCRIPTION),
                      ('identifier', IDENTIFIER), ('enabled', ENABLED)):
        value, _ = attribute(target, name)
        if value not in (None, ''):
            info[key] = value
    info['frame'] = frame(target)
    info['actions'] = action_names(target)
    return info


def collect(root, max_depth=8, max_nodes=600, note_children=True):
    """[(element_ref, info)] depth-first; refs stay retained until release_all()."""
    nodes = []

    def visit(target, depth):
        if len(nodes) >= max_nodes:
            return
        info = describe(target, depth)
        children, code = attribute_element(target, CHILDREN)
        if children is None:
            children, code = attribute_element(target, WINDOWS)
        if children is None:
            children, code = attribute_element(target, SHEETS)
        child_count = _CF.CFArrayGetCount(children) if children else 0
        info['childCount'] = child_count
        info['childrenError'] = code if children is None else 0
        nodes.append((target, info))
        if children is None or depth >= max_depth:
            if children:
                _CF.CFRelease(children)
            return
        try:
            for index in range(child_count):
                if len(nodes) >= max_nodes:
                    info['truncated'] = True
                    break
                child = _CF.CFArrayGetValueAtIndex(children, index)
                if not child:
                    continue
                _CF.CFRetain(child)
                visit(child, depth + 1)
        finally:
            _CF.CFRelease(children)

    _CF.CFRetain(root)
    visit(root, 0)
    return nodes


def release_all(nodes):
    for target, _ in nodes:
        _CF.CFRelease(target)


def label(info):
    parts = [info.get('role') or '?']
    if info.get('subrole'):
        parts.append(info['subrole'])
    for key in ('title', 'placeholder', 'identifier'):
        if info.get(key):
            parts.append('%s=%r' % (key, info[key]))
            break
    return ' '.join(parts)


def to_json(nodes, root_note=None):
    return {'version': 1, 'trusted': trusted(), 'count': len(nodes), 'root': root_note,
            'nodes': [info for _, info in nodes]}


def find(nodes, role=None, title=None, titles=None, placeholder=None, placeholder_contains=None,
         min_width=None):
    hits = []
    for target, info in nodes:
        if role and info.get('role') != role:
            continue
        if title is not None and info.get('title') != title:
            continue
        if titles is not None and info.get('title') not in titles:
            continue
        if placeholder is not None and info.get('placeholder') != placeholder:
            continue
        if placeholder_contains is not None and placeholder_contains not in (info.get('placeholder') or ''):
            continue
        if min_width is not None:
            box = info.get('frame') or {}
            if (box.get('Width') or 0) < min_width:
                continue
        hits.append((target, info))
    return hits


def subtree(nodes, index):
    """The nodes below nodes[index], using the recorded depth."""
    base = nodes[index][1]['depth']
    out = [nodes[index]]
    for target, info in nodes[index + 1:]:
        if info['depth'] <= base:
            break
        out.append((target, info))
    return out


def dump(pid, max_depth=8, max_nodes=600):
    app = element(pid)
    nodes = collect(app, max_depth=max_depth, max_nodes=max_nodes)
    windows, code = attribute_element(app, WINDOWS)
    note = {'pid': pid, 'windowsError': code}
    if windows:
        note['windows'] = _python_value(windows)
        _CF.CFRelease(windows)
    payload = to_json(nodes, note)
    release_all(nodes)
    _CF.CFRelease(app)
    return payload


def main():
    if len(sys.argv) < 3 or sys.argv[2] != 'dump':
        print(__doc__)
        return 2
    pid = int(sys.argv[1])
    max_depth = 8
    max_nodes = 600
    if '--max-depth' in sys.argv:
        max_depth = int(sys.argv[sys.argv.index('--max-depth') + 1])
    if '--max-nodes' in sys.argv:
        max_nodes = int(sys.argv[sys.argv.index('--max-nodes') + 1])
    print(json.dumps(dump(pid, max_depth, max_nodes), ensure_ascii=False, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
