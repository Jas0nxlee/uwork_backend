#!/usr/bin/env python3
"""Single entry for the G07e panel interaction: verify the grant, then run the panel phase.

The panel's GoTo path input and allow/deny/cancel outcomes need the macOS Accessibility
permission that governs synthetic key events. This gate checks it with the exact API and
either refuses with the precise toggle to flip, or runs the interaction phase unattended.
"""
import ctypes
import ctypes.util
import os
import subprocess
import sys
from pathlib import Path

REPO = Path('/Users/ljp/Desktop/uwork_backend')
PROBE = REPO / 'scripts/tests/native-g07e-cdp-probe.py'


def synthetic_key_access():
    """The exact API for posting synthetic key events (not a proxy signal)."""
    core_graphics = ctypes.cdll.LoadLibrary(
        '/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
    core_graphics.CGPreflightPostEventAccess.restype = ctypes.c_bool
    return bool(core_graphics.CGPreflightPostEventAccess())


def accessibility_trusted():
    services = ctypes.cdll.LoadLibrary(ctypes.util.find_library('ApplicationServices'))
    services.AXIsProcessTrusted.restype = ctypes.c_bool
    return bool(services.AXIsProcessTrusted())


def responsible_pid():
    """The app macOS attributes the permission to; verified live as UWork.app."""
    for library in ('/usr/lib/system/libsystem_kernel.dylib', '/usr/lib/libSystem.B.dylib'):
        try:
            handle = ctypes.cdll.LoadLibrary(library)
        except OSError:
            continue
        if not hasattr(handle, 'responsibility_get_pid_responsible_for_pid'):
            continue
        handle.responsibility_get_pid_responsible_for_pid.restype = ctypes.c_int
        handle.responsibility_get_pid_responsible_for_pid.argtypes = [
            ctypes.c_int, ctypes.POINTER(ctypes.c_int)]
        out = ctypes.c_int(0)
        code = handle.responsibility_get_pid_responsible_for_pid(
            ctypes.c_int(os.getpid()), ctypes.byref(out))
        if code > 1:
            return code
    return None


def main():
    posting = synthetic_key_access()
    trusted = accessibility_trusted()
    owner = responsible_pid()
    owner_name = ''
    if owner:
        completed = subprocess.run(['ps', '-o', 'comm=', '-p', str(owner)],
                                   capture_output=True, text=True)
        owner_name = completed.stdout.strip()
    print(json_line({'syntheticKeyAccess': posting, 'accessibilityTrusted': trusted,
                     'responsiblePid': owner, 'responsibleApp': owner_name}))
    if not posting or not trusted:
        print('BLOCKED: 系统设置 → 隐私与安全性 → 辅助功能 → 打开 '
              + (owner_name or 'UWork') + '（实测责任进程 ' + str(owner) + '）')
        print('授权后重跑本命令即可：python3 ' + str(PROBE.relative_to(REPO)) + ' --phase panel-interaction')
        return 2
    # An optional profile keeps an already-recorded run intact: the probe deletes its own
    # data/evidence directories before starting.
    profile = None
    arguments = sys.argv[1:]
    if arguments:
        if len(arguments) == 2 and arguments[0] == '--profile':
            profile = arguments[1]
        else:
            print('usage: native-g07e-panel-gate.py [--profile client-native-g07e-...]')
            return 2
    command = [sys.executable, str(PROBE), '--phase', 'panel-interaction']
    if profile:
        command[2:2] = ['--profile', profile]
    completed = subprocess.run(command, cwd=REPO)
    return completed.returncode


def json_line(value):
    import json
    return json.dumps(value, ensure_ascii=False)


if __name__ == '__main__':
    sys.exit(main())
