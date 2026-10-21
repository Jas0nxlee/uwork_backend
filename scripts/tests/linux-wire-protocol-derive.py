"""Exactly one inert raw Unicode query label; all original protocol assertions remain byte-equal."""
import hashlib
from pathlib import Path

ANCHOR = "            url = 'zcode://workspace/open?' + urllib.parse.urlencode({'path': target})"
SUFFIX = " + '&wireLabel=中文'"


def derive_protocol(source_path, destination):
    source = Path(source_path).read_text()
    assert source.count(ANCHOR) == 1, 'One exact original URI anchor required'
    assert '&wireLabel=' not in source
    derived = source.replace(ANCHOR, ANCHOR + SUFFIX, 1)
    assert derived.replace(ANCHOR + SUFFIX, ANCHOR, 1) == source
    Path(destination).write_text(derived)
    return {'originalSha256': hashlib.sha256(source.encode()).hexdigest(),
            'derivedSha256': hashlib.sha256(derived.encode()).hexdigest(),
            'extraRawQuery': '&wireLabel=中文', 'extraQueryHasBusinessMeaning': False,
            'sourceUnchanged': Path(source_path).read_text() == source,
            'onlyOneAnchorChanged': True}


if __name__ == '__main__':
    print('prepared-not-run: no URI, process, Docker or GUI is launched')
