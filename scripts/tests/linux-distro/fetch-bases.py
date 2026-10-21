"""Fetch and cryptographically verify authentic AArch64 distro base archives.

Host-side only: never starts Docker, changes host trust stores, or runs a GUI.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import urllib.parse
import urllib.request

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / 'data/sandbox-verification/linux-distro-bases-20261020'
EVIDENCE = REPO / 'evidence/client-linux-distro-bases-20261020'
ARCH_KEY = '68B3537F39A313B3E574D06777193F152BDBE6A6'
FEDORA_ROOT = 'https://dl.fedoraproject.org/pub/fedora/linux/releases/44/Container/aarch64/images/'
FEDORA_IMAGE = 'Fedora-Container-Base-Generic-44-1.7.aarch64.oci.tar.xz'
CHECKSUM = 'Fedora-Container-44-1.7-aarch64-CHECKSUM'
ARCH_IMAGE = 'ArchLinuxARM-aarch64-latest.tar.gz'
ARCH_ROOT = 'https://ca.us.mirror.archlinuxarm.org/os/'


class HttpsRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        assert urllib.parse.urlparse(newurl).scheme == 'https', newurl
        return super().redirect_request(request, fp, code, msg, headers, newurl)


def fetch(url, filename, reuse=False):
    assert url.startswith('https://')
    destination = DATA / filename
    if reuse and destination.exists():
        return destination
    temporary = destination.with_name(destination.name + '.partial')
    opener = urllib.request.build_opener(HttpsRedirects())
    with opener.open(url, timeout=60) as response, temporary.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    temporary.replace(destination)
    return destination


def execute(args):
    result = subprocess.run(args, text=True, capture_output=True, timeout=60)
    receipts.append({'command': args, 'returncode': result.returncode,
                     'stdout': result.stdout, 'stderr': result.stderr})
    result.check_returncode()
    return result.stdout


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        while chunk := source.read(1024 * 1024):
            value.update(chunk)
    return {'bytes': path.stat().st_size, 'sha256': value.hexdigest()}


parser = argparse.ArgumentParser()
parser.add_argument('--archives', action='store_true', help='Also download and verify the large archives')
args = parser.parse_args()
DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
EVIDENCE.mkdir(parents=True, exist_ok=True, mode=0o700)
receipts = []
facts = {'status': 'failed', 'archivesRequested': args.archives, 'receipts': receipts,
         'startedAtUtc': datetime.now(timezone.utc).isoformat()}
try:
    fedora_keys = fetch('https://fedoraproject.org/fedora.gpg', 'fedora.gpg')
    checksum = fetch(FEDORA_ROOT + CHECKSUM, CHECKSUM)
    verified = DATA / 'fedora-verified-checksums.txt'
    plaintext = execute(['gpgv', '--status-fd', '2', '--keyring', str(fedora_keys),
                         '--output', '-', str(checksum)])
    verified.write_text(plaintext)
    key = fetch('https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x' + ARCH_KEY,
                'arch-build-key.asc')
    with tempfile.TemporaryDirectory(prefix='uwork-distro-gpg-') as home:
        shown = execute(['gpg', '--homedir', home, '--batch', '--with-colons', '--show-keys', str(key)])
        fingerprints = [line.split(':')[9] for line in shown.splitlines() if line.startswith('fpr:')]
        assert ARCH_KEY in fingerprints, fingerprints
        execute(['gpg', '--homedir', home, '--batch', '--import', str(key)])
        signature = fetch(ARCH_ROOT + ARCH_IMAGE + '.sig', ARCH_IMAGE + '.sig')
        if args.archives:
            fedora = fetch(FEDORA_ROOT + FEDORA_IMAGE, FEDORA_IMAGE, reuse=True)
            matches = [line for line in verified.read_text().splitlines()
                       if line.startswith('SHA256 (' + FEDORA_IMAGE + ') = ')]
            assert len(matches) == 1, matches
            expected_hash = matches[0].split(' = ')[-1].strip()
            assert digest(fedora)['sha256'] == expected_hash, matches
            arch = fetch(ARCH_ROOT + ARCH_IMAGE, ARCH_IMAGE, reuse=True)
            status = execute(['gpg', '--homedir', home, '--batch', '--status-fd', '1',
                              '--verify', str(signature), str(arch)])
            assert any(line.startswith('[GNUPG:] VALIDSIG ' + ARCH_KEY + ' ')
                       for line in status.splitlines()), status
            facts['archives'] = {p.name: digest(p) for p in [fedora, arch]}
    facts['status'] = 'archives-verified' if args.archives else 'trust-material-prepared'
    facts['smallFiles'] = {p.name: digest(p) for p in [fedora_keys, checksum, key, signature]}
finally:
    facts['finishedAtUtc'] = datetime.now(timezone.utc).isoformat()
    name = 'archives-result.json' if args.archives else 'trust-material-result.json'
    (EVIDENCE / name).write_text(json.dumps(facts, indent=2) + '\n')
print(json.dumps({'status': facts['status'], 'evidence': str(EVIDENCE)}))
