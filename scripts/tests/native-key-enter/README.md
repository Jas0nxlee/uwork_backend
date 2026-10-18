# Shared Native Enter driver regression

The shared helper sends a carriage return only on plain main Enter keyDown. keyUp, modified Enter shortcuts and other keys retain their prior protocol. Same Electron evidence showed that down/up without text produced no keypress or implicit form submit. This is a test-driver contract, not UWork login or sharing acceptance.

Run the pure AST protocol test:

```sh
python3 scripts/tests/native-key-enter/test_key_protocol.py
```

Run the real three-form regression with explicit configured executables and a **new** evidence directory:

```sh
node scripts/tests/native-key-enter/run.mjs \
  --electron "$UWORK_TEST_ELECTRON_PATH" \
  --browser-harness "$UWORK_TEST_BROWSER_HARNESS" \
  --bh-python "$UWORK_TEST_BH_PYTHON" \
  --evidence "$PWD/evidence/native-key-enter-new-run"
```

Set the three variables to absolute executable paths first. The Electron executable must belong to this repository's `data/` directory. Use the configured Node 24 runtime and choose an unused evidence leaf for every run.

The runner refuses an existing evidence leaf. It extracts the actual current shared key() with AST; it does not import the application helper module or copy a second implementation. Case A uses that extraction, B independently supplies CR text, and C clicks a real Submit button. A/B single-input forms have no submit button. Every case must submit once, and both Enter cases must produce keypress.

Only one isolated Electron launch and a fresh private /tmp profile/BH environment are used. Explicit CDP prevents personal Chrome discovery. There are no UWork Main/Host/CLI, backend/model calls, credentials, environment-file reads or retained-root traversal. Source SHA, Engine versions, trusted events, exact owned process closure, port refusal and write-FD checks are recorded. Scratch is deleted only after full closure; otherwise it remains private and the test fails. No automatic browser retry or assertion suppression.

Historical Native authorized reading and logout remain unverified until a separate real UWork run passes. Preserve the original failed evidence; do not rerun its sealed runner after changing the shared helper.
