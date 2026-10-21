#!/usr/bin/env python3
"""Read-only WindowServer projection: on-screen windows as JSON lines.

Uses only CoreGraphics window metadata (no Accessibility, no Screen Recording): owner pid,
owner name, window name, layer and bounds. Screen contents are never captured. Used to prove
that the original composer entry opened a real system panel owned by the owned Electron process.
"""
import ctypes as C
import ctypes.util
import json
import sys

core_graphics = C.cdll.LoadLibrary(
    '/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
core_foundation = C.cdll.LoadLibrary(ctypes.util.find_library('CoreFoundation'))

core_graphics.CGWindowListCopyWindowInfo.restype = C.c_void_p
core_graphics.CGWindowListCopyWindowInfo.argtypes = [C.c_uint32, C.c_uint32]
core_foundation.CFArrayGetCount.restype = C.c_long
core_foundation.CFArrayGetCount.argtypes = [C.c_void_p]
core_foundation.CFArrayGetValueAtIndex.restype = C.c_void_p
core_foundation.CFArrayGetValueAtIndex.argtypes = [C.c_void_p, C.c_long]
core_foundation.CFDictionaryGetValueIfPresent.restype = C.c_bool
core_foundation.CFDictionaryGetValueIfPresent.argtypes = [C.c_void_p, C.c_void_p, C.POINTER(C.c_void_p)]
core_foundation.CFStringCreateWithCString.restype = C.c_void_p
core_foundation.CFStringCreateWithCString.argtypes = [C.c_void_p, C.c_char_p, C.c_uint32]
core_foundation.CFStringGetCString.restype = C.c_bool
core_foundation.CFStringGetCString.argtypes = [C.c_void_p, C.c_char_p, C.c_long, C.c_uint32]
core_foundation.CFNumberGetValue.restype = C.c_bool
core_foundation.CFNumberGetValue.argtypes = [C.c_void_p, C.c_long, C.c_void_p]
core_foundation.CFRelease.argtypes = [C.c_void_p]

K_CF_STRING_ENCODING_UTF8 = 0x08000100
K_CF_NUMBER_SINT32 = 3
K_CF_NUMBER_DOUBLE = 13
ON_SCREEN_ONLY = 1
NULL_WINDOW = 0


def key(name):
    return core_foundation.CFStringCreateWithCString(None, name.encode('utf-8'), K_CF_STRING_ENCODING_UTF8)


def string_value(entry, name):
    handle = C.c_void_p()
    key_ref = key(name)
    try:
        if not core_foundation.CFDictionaryGetValueIfPresent(entry, key_ref, C.byref(handle)):
            return None
        buffer = C.create_string_buffer(1024)
        if not core_foundation.CFStringGetCString(handle, buffer, 1024, K_CF_STRING_ENCODING_UTF8):
            return None
        return buffer.value.decode('utf-8', 'replace')
    finally:
        core_foundation.CFRelease(key_ref)


def number_value(entry, name, kind):
    handle = C.c_void_p()
    key_ref = key(name)
    try:
        if not core_foundation.CFDictionaryGetValueIfPresent(entry, key_ref, C.byref(handle)):
            return None
        out = C.c_int32(0) if kind == 'int' else C.c_double(0)
        ok = core_foundation.CFNumberGetValue(
            handle, K_CF_NUMBER_SINT32 if kind == 'int' else K_CF_NUMBER_DOUBLE, C.byref(out))
        return out.value if ok else None
    finally:
        core_foundation.CFRelease(key_ref)


def bounds(entry):
    handle = C.c_void_p()
    key_ref = key('kCGWindowBounds')
    try:
        if not core_foundation.CFDictionaryGetValueIfPresent(entry, key_ref, C.byref(handle)):
            return None
        return {
            axis: number_value(handle, axis, 'double')
            for axis in ('X', 'Y', 'Width', 'Height')
        }
    finally:
        core_foundation.CFRelease(key_ref)


def windows():
    array = core_graphics.CGWindowListCopyWindowInfo(ON_SCREEN_ONLY, NULL_WINDOW)
    if not array:
        return []
    result = []
    try:
        for index in range(core_foundation.CFArrayGetCount(C.c_void_p(array))):
            entry = core_foundation.CFArrayGetValueAtIndex(C.c_void_p(array), index)
            result.append({
                'ownerPid': number_value(entry, 'kCGWindowOwnerPID', 'int'),
                'ownerName': string_value(entry, 'kCGWindowOwnerName'),
                'windowName': string_value(entry, 'kCGWindowName'),
                'layer': number_value(entry, 'kCGWindowLayer', 'int'),
                'bounds': bounds(entry),
            })
    finally:
        core_foundation.CFRelease(C.c_void_p(array))
    return result


def frontmost_normal_pid():
    """Owner pid of the frontmost layer-0 window; the WindowServer lists front-to-back.

    Layer 0 excludes the menubar and other system overlays. No permission is required for
    window metadata, so this is the guard the PID-directed keyboard driver checks before
    every synthetic key batch.
    """
    for window in windows():
        if window['layer'] == 0 and window['ownerPid']:
            return window['ownerPid']
    return None


# The Dock owns layer 20 and the menubar 24; sheets, alerts and dialogs sit above the normal
# window layer but below those two.
WINDOW_LAYER_CEILING = 20


def frontmost_visible_window():
    """The frontmost window above layer 0 but below the Dock.

    A layer-0-only check misses a system dialog or alert raised above the app, which is exactly
    where a posted key would land, so the guard needs the topmost of both kinds.
    """
    for window in windows():
        layer = window['layer'] if window['layer'] is not None else 0
        if 0 <= layer < WINDOW_LAYER_CEILING and window['ownerPid']:
            return window
    return None


def visible_windows():
    """Every on-screen window above layer 0 and below the Dock, front to back."""
    return [window for window in windows()
            if 0 <= (window['layer'] if window['layer'] is not None else 0) < WINDOW_LAYER_CEILING]


def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--front':
        print(json.dumps({'version': 1, 'frontmostNormalPid': frontmost_normal_pid()}))
        return
    if len(sys.argv) > 1 and sys.argv[1] == '--front-all':
        front = frontmost_visible_window()
        print(json.dumps({'version': 1,
                          'frontmostPid': front['ownerPid'] if front else None,
                          'frontmostName': front['ownerName'] if front else None,
                          'frontmostLayer': front['layer'] if front else None,
                          'frontmostBounds': front['bounds'] if front else None},
                         ensure_ascii=False))
        return
    if len(sys.argv) > 1 and sys.argv[1] == '--visible':
        print(json.dumps({'version': 1, 'count': len(visible_windows()), 'windows': visible_windows()},
                         ensure_ascii=False))
        return
    pid_filter = int(sys.argv[1]) if len(sys.argv) > 1 else None
    rows = windows()
    if pid_filter is not None:
        rows = [row for row in rows if row['ownerPid'] == pid_filter]
    print(json.dumps({'version': 1, 'pid': pid_filter, 'count': len(rows), 'windows': rows},
                     ensure_ascii=False))


if __name__ == '__main__':
    main()
