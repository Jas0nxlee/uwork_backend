"""Only this new candidate profile expression changes; original owned PID/log guards remain."""
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
BASE=REPO/'scripts/tests/macos-x64-startup-log.py'
BEFORE="r'client-native-packaged-macos-x64-startup-v[0-9]+-20261020'"
AFTER="r'client-native-packaged-macos-clock-(?:x64|arm64)-secondary-exit-v[0-9]+-20261021'"
def deriveSecondaryExitLog(source):
    assert source.count(BEFORE)==1
    return source.replace(BEFORE,AFTER)
_scope={'__file__':str(BASE),'__name__':'owned_secondary_exit_log'}
exec(compile(deriveSecondaryExitLog(BASE.read_text()),str(BASE),'exec'),_scope)
read_owned_single_instance_phases=_scope['read_owned_single_instance_phases']
def validate_secondary_exit_profile(profile):
    assert _scope['PROFILE'].fullmatch(profile),'Exact new secondary-exit profile required'
    return profile
