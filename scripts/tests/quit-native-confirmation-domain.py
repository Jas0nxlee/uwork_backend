"""Quit-only direct native confirmation discovery. Pure import; original actions remain owner."""

import math, time


def _remaining(deadline):
    left = deadline - time.monotonic()
    assert (
        math.isfinite(left) and left > 0
    ), "Original Quit operation deadline exhausted"
    return left


def collect_quit_native_candidates(self, pid, deadline):
    assert pid == self.pid and deadline == self.deadline
    guard = self._quit_native_guard
    assert callable(guard)

    def checked(call):
        _remaining(deadline)
        guard()
        _remaining(deadline)
        value = call()
        _remaining(deadline)
        guard()
        _remaining(deadline)
        return value

    def children(ref, name):
        rows = checked(lambda: self._children(ref, name))
        assert isinstance(rows, list) and len(rows) <= 128
        return rows

    seen = set()
    found = []
    native_refs = set()

    def inspect(ref, depth):
        if ref in seen:
            return None
        seen.add(ref)
        assert len(seen) <= 128 and depth <= 4
        checked(lambda: self._own(ref))
        role = checked(lambda: self._value(ref, "AXRole"))
        subrole = checked(lambda: self._value(ref, "AXSubrole"))
        assert isinstance(role, str) and role
        assert subrole is None or isinstance(subrole, str)
        if role == "AXSheet" or subrole in ("AXDialog", "AXSystemDialog"):
            row = checked(lambda: self._candidate(ref))
            assert row["pid"] == pid
            found.append(row)
            native_refs.add(ref)
            return True
        return False

    def create_application():
        ref = self.ax["element"](pid)
        assert ref
        # AXCreateApplication owns this reference before a post-call guard can fail.
        self.refs.append(ref)
        return ref

    application = checked(create_application)
    checked(lambda: self._own(application))
    for window in children(application, "AXWindows"):
        native = inspect(window, 0)
        if native is None or native:
            continue
        # AXWindows must expose a real window/native dialog, never a random group.
        assert checked(lambda: self._value(window, "AXRole")) == "AXWindow"
        for ref in children(window, "AXSheets"):
            inspect(ref, 1)
            assert (
                ref in native_refs
            ), "AXSheets must expose a native confirmation container"
        for ref in children(window, "AXChildren"):
            inspect(ref, 1)
    return found


def wait_quit_candidates(adapter, pid, deadline, guard):
    assert deadline == adapter.deadline and callable(guard)
    adapter._quit_native_guard = guard
    while True:
        _remaining(deadline)
        guard()
        _remaining(deadline)
        start = len(adapter.refs)
        keep = False
        try:
            rows = adapter.candidates(pid, deadline)
            _remaining(deadline)
            guard()
            _remaining(deadline)
            assert isinstance(rows, list)
            if rows:
                keep = True
                return rows
        finally:
            if not keep:
                while len(adapter.refs) > start:
                    adapter.cf.CFRelease(adapter.refs.pop())
        time.sleep(min(0.05, _remaining(deadline)))
        _remaining(deadline)
        guard()
        _remaining(deadline)


def derive_quit_domain_ax_module(original):
    anchor = 'adapter.candidates(binding["pid"], end)'
    assert original.count(anchor) == 1
    source = original.replace(
        anchor, 'wait_quit_candidates(adapter,binding["pid"],end,guard)'
    )
    source += '\n_QUIT_DOMAIN=runpy.run_path(str(Path(__file__).with_name("quit-native-confirmation-domain.py")))\n_QuitAx.candidates=_QUIT_DOMAIN["collect_quit_native_candidates"]\nwait_quit_candidates=_QUIT_DOMAIN["wait_quit_candidates"]\n'
    compile(source, "owned-quit-native-domain", "exec")
    return source
