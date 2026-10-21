"""Real derived readiness entry contracts, with fake time/fetch and no network."""

from pathlib import Path
import runpy
import unittest
import urllib.error
import urllib.request

SOURCE = Path(__file__).with_name("macos-x64-readiness.py").read_text()
M = runpy.run_path(str(Path(__file__).with_name("macos-x64-secondary-readiness.py")))
OLD = runpy.run_path(str(Path(__file__).with_name("macos-x64-readiness.py")))
PREFIX = "file:///owned/UWork%20Preview.app/Contents/Resources/app.asar/"
PORT = 12345


def page():
    return {
        "id": "owned",
        "type": "page",
        "url": PREFIX + "out/renderer/index.html",
        "webSocketDebuggerUrl": "ws://127.0.0.1:12345/devtools/page/owned",
    }


class SecondaryReadiness(unittest.TestCase):
    def test_actual_alias_accepts60_while61_and_original30_reject60(self):
        calls = []
        value = M["wait_secondary_primary_target"](
            PORT,
            PREFIX,
            lambda: True,
            lambda _: None,
            seconds=60,
            fetch=lambda *_: calls.append("fetch") or [page()],
            now=lambda: 0,
            sleep=lambda _: self.fail("Unexpected sleep"),
        )
        self.assertEqual(value["id"], "owned")
        self.assertEqual(calls, ["fetch"])
        for function, seconds in [
            (M["wait_secondary_primary_target"], 61),
            (OLD["wait_owned_renderer"], 60),
        ]:
            with self.assertRaises(AssertionError):
                function(
                    PORT,
                    PREFIX,
                    lambda: self.fail("Invalid budget reached guard"),
                    lambda _: None,
                    seconds=seconds,
                    fetch=lambda *_: self.fail("Invalid budget fetched"),
                )

    def test_only_budget_guard_and_timeout_words_change_with_exact_reverse_identity(
        self,
    ):
        derived = M["deriveSecondaryReadiness"](SOURCE)
        restored = derived.replace("0 < seconds <= 60", "0 < seconds <= 30").replace(
            M["DIAGNOSTIC_TIMEOUT"], M["ORIGINAL_TIMEOUT"]
        )
        self.assertEqual(restored, SOURCE)
        self.assertIn("seconds=30, fetch=fetch_owned_targets", derived)
        self.assertIn("urllib.request.ProxyHandler({}), NoRedirect()", derived)
        with self.assertRaises(AssertionError):
            M["deriveSecondaryReadiness"](SOURCE + SOURCE)
        with self.assertRaises(AssertionError):
            M["deriveSecondaryReadiness"](
                SOURCE.replace("0 < seconds <= 30", "0 < seconds <= 31")
            )

    def test_missing_or_changed_owner_never_fetches_and_timeout_is_finite(self):
        clock = [0.0]
        calls = []

        def sleep(value):
            clock[0] += value

        with self.assertRaisesRegex(TimeoutError, "Diagnostic"):
            M["wait_secondary_primary_target"](
                PORT,
                PREFIX,
                lambda: False,
                lambda _: None,
                seconds=60,
                fetch=lambda *_: calls.append(1),
                now=lambda: clock[0],
                sleep=sleep,
            )
        self.assertEqual(calls, [])
        self.assertLessEqual(clock[0], 60.001)

        def changed():
            raise AssertionError("PID birth changed")

        with self.assertRaises(AssertionError):
            M["wait_secondary_primary_target"](
                PORT,
                PREFIX,
                changed,
                lambda _: None,
                seconds=60,
                fetch=lambda *_: calls.append(1),
            )
        self.assertEqual(calls, [])
        with self.assertRaises(AssertionError):
            M["wait_secondary_primary_target"](
                0,
                PREFIX,
                lambda: self.fail("Invalid port reached owner"),
                lambda _: None,
                seconds=60,
                fetch=lambda *_: calls.append(1),
            )
        self.assertEqual(calls, [])

    def test_actual_derived_target_and_redirect_guards_remain_strict(self):
        ns = M["wait_secondary_primary_target"].__globals__
        selected = page()
        self.assertIs(ns["select_owned_renderer"]([selected], PREFIX, PORT), selected)
        for address in [
            "ws://localhost:12345/devtools/page/owned",
            "ws://127.0.0.1:54321/devtools/page/owned",
            "ws://127.0.0.1:12345/devtools/page/foreign",
        ]:
            bad = {**page(), "webSocketDebuggerUrl": address}
            with self.assertRaises(AssertionError):
                ns["select_owned_renderer"]([bad], PREFIX, PORT)
        with self.assertRaises(urllib.error.HTTPError) as error:
            ns["NoRedirect"]().redirect_request(
                urllib.request.Request("http://127.0.0.1:12345/json/list"),
                None,
                302,
                "Found",
                {},
                "https://foreign/",
            )
        error.exception.close()
        count = [0]

        def guard():
            count[0] += 1
            return count[0] == 1

        with self.assertRaises(AssertionError):
            M["wait_secondary_primary_target"](
                PORT,
                PREFIX,
                guard,
                lambda _: None,
                seconds=60,
                fetch=lambda *_: [page()],
                now=lambda: 0,
                sleep=lambda _: None,
            )


if __name__ == "__main__":
    unittest.main()
