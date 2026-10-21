"""Private60s primary diagnostic variant; original30s renderer acceptance is unchanged."""

from pathlib import Path

ORIGINAL_TIMEOUT = "Original owned file renderer not ready within 30s budget"
DIAGNOSTIC_TIMEOUT = "Diagnostic owned primary file renderer not ready within60s; original30s acceptance unchanged"


def deriveSecondaryReadiness(originalOldSource):
    guard = "0 < seconds <= 30"
    assert originalOldSource.count(guard) == 1
    assert originalOldSource.count(ORIGINAL_TIMEOUT) == 1
    return originalOldSource.replace(guard, "0 < seconds <= 60").replace(
        ORIGINAL_TIMEOUT, DIAGNOSTIC_TIMEOUT
    )


_original_path = Path(__file__).with_name("macos-x64-readiness.py")
_original_source = _original_path.read_text()
_derived_source = deriveSecondaryReadiness(_original_source)
_namespace = {
    "__file__": str(_original_path),
    "__name__": "owned_secondary_primary_readiness",
}
exec(
    compile(_derived_source, str(_original_path) + "[private60s-diagnostic]", "exec"),
    _namespace,
)
wait_secondary_primary_target = _namespace["wait_owned_renderer"]
