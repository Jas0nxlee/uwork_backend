"""Profile-only variant; original PID/file/phase/secret guards are unchanged."""
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
BASE=REPO/'scripts/tests/macos-x64-startup-log.py'
BEFORE="r'client-native-packaged-macos-x64-startup-v[0-9]+-20261020'"
AFTER="r'client-native-packaged-macos-clock-x64-startup-v[0-9]+-20261021'"
def deriveClockStartupLog(source):
    assert source.count(BEFORE)==1
    return source.replace(BEFORE,AFTER)
_scope={'__file__':str(BASE),'__name__':'owned_clock_startup_log'}
exec(compile(deriveClockStartupLog(BASE.read_text()),str(BASE),'exec'),_scope)
read_owned_single_instance_phases=_scope['read_owned_single_instance_phases']
def validate_clock_startup_profile(profile):
    assert _scope['PROFILE'].fullmatch(profile),'Exact new clock startup profile required'
    return profile
