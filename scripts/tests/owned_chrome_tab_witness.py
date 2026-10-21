"""Read only native Chrome tab controls matching an owned title; never traverse web content."""
import ctypes as C
from pathlib import Path
import runpy

AX = runpy.run_path(str(Path(__file__).with_name('macos-ax-driver.py')))


def empty_children_result(code):
    # Apple AXError.h: unsupported/no-value are leaves; CannotComplete (-25204) is not.
    return code in (0, -25205, -25212)


def inspect_owned_tab(pid, title):
    assert isinstance(pid, int) and pid > 1
    assert title.startswith('UWork external-link ') and len(title) < 80
    assert AX['trusted'](), 'Accessibility observation permission unavailable'
    cf, native = AX['_CF'], AX['_AX']
    names = {key: AX['_cf_string'](key) for key in ['AXRole', 'AXTitle', 'AXDescription', 'AXChildren', 'AXWindows']}
    app = AX['element'](pid)
    windows = C.c_void_p()
    windows_error = native.AXUIElementCopyAttributeValue(app, names['AXWindows'], C.byref(windows))
    pending = []
    if windows_error == 0 and windows:
        for index in range(cf.CFArrayGetCount(windows)):
            pending.append((cf.CFRetain(cf.CFArrayGetValueAtIndex(windows, index)), 0))
        cf.CFRelease(windows)
    cf.CFRelease(app)
    window_count = len(pending)
    matches, failures, visited, skipped_web = [], 0, 0, 0
    error_codes = []

    def value(element, key):
        output = C.c_void_p()
        code = native.AXUIElementCopyAttributeValue(element, names[key], C.byref(output))
        if code != 0 or not output:
            return None, code
        try:
            return AX['_python_value'](output, 200), 0
        finally:
            cf.CFRelease(output)

    try:
        while pending:
            element, depth = pending.pop()
            try:
                visited += 1
                if visited > 4000 or depth > 20:
                    failures += 1
                    continue
                role, code = value(element, 'AXRole')
                if code:
                    failures += 1
                    error_codes.append({'attribute': 'AXRole', 'code': code})
                    continue
                if role in ('AXWebArea', 'AXMenuBar'):
                    skipped_web += int(role == 'AXWebArea')
                    continue
                # The only strings compared are native control labels. Nonmatching labels are discarded.
                if role in ('AXWindow', 'AXRadioButton'):
                    label, _ = value(element, 'AXTitle')
                    description, _ = value(element, 'AXDescription')
                    if title in (label or '') or title in (description or ''):
                        matches.append({'role': role, 'depth': depth})
                children = C.c_void_p()
                code = native.AXUIElementCopyAttributeValue(element, names['AXChildren'], C.byref(children))
                if code == 0 and children:
                    try:
                        for index in range(cf.CFArrayGetCount(children)):
                            child = cf.CFArrayGetValueAtIndex(children, index)
                            pending.append((cf.CFRetain(child), depth + 1))
                    finally:
                        cf.CFRelease(children)
                elif not empty_children_result(code):
                    failures += 1
                    error_codes.append({'attribute': 'AXChildren', 'role': role, 'code': code})
            finally:
                cf.CFRelease(element)
    finally:
        for element, _ in pending:
            cf.CFRelease(element)
        for item in names.values():
            cf.CFRelease(item)
    return {'pid': pid, 'complete': failures == 0 and windows_error == 0, 'windowsError': windows_error,
            'windowCount': window_count, 'failures': failures, 'errorCodes': error_codes[:20], 'visitedNativeNodes': visited,
            'skippedWebAreas': skipped_web, 'matchingControls': matches,
            'tabMatches': sum(m['role'] == 'AXRadioButton' for m in matches),
            'windowMatches': sum(m['role'] == 'AXWindow' for m in matches)}
