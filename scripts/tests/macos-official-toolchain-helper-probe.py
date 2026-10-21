"""Verify one official whole toolchain in owned cache, then compile unchanged helper; no install/GUI."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path('/Users/ljp/Library/Caches/uwork-backend/client-macos-x64-official-toolchain-20261020')
EVIDENCE = ROOT / 'evidence/client-macos-x64-official-toolchain-research-20261020'
PACKAGE = CACHE / 'swift-6.4.1-RELEASE-osx.pkg'
SOURCE = ROOT / 'clients/uwork/packages/desktop/native/macos-window-bounds/main.swift'
SOURCE_SHA = 'd0eb18e8fc42d4ab935d49e0823aa53ae14670237e51d3b058a021b661d4029a'
SDK = Path('/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk')
FACTS = {'status': 'failed', 'scope': 'official whole-toolchain private probe; no installer, global registration, product source/output change or helper execution', 'receipts': []}


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def run(label, command, *, timeout=120, env=None, check=True):
    print(json.dumps({'phase': label, 'state': 'started'}), flush=True)
    started = time.time()
    process = subprocess.run([str(x) for x in command], cwd=ROOT, env=env, text=True, capture_output=True, timeout=timeout)
    receipt = {'label': label, 'argv': [str(x) for x in command], 'startedAt': started, 'finishedAt': time.time(), 'exitCode': process.returncode, 'stdout': process.stdout, 'stderr': process.stderr}
    FACTS['receipts'].append(receipt)
    (EVIDENCE / (label + '.json')).write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'phase': label, 'exitCode': process.returncode}), flush=True)
    if check:
        process.check_returncode()
    return process


try:
    FACTS['probeSourceSha256'] = digest(Path(__file__))
    assert CACHE.is_dir() and CACHE.stat().st_mode & 0o777 == 0o700
    assert SOURCE.is_file() and digest(SOURCE) == SOURCE_SHA
    download = json.loads((EVIDENCE / 'download-result.json').read_text())
    assert download['status'] == 'downloaded-not-yet-signature-verified'
    assert PACKAGE.stat().st_size == download['bytes'] == 1590804750
    assert digest(PACKAGE) == download['sha256']
    FACTS['packageSha256'] = download['sha256']
    signature = run('full-package-signature', ['/usr/sbin/pkgutil', '--check-signature', PACKAGE])
    assert 'Status: signed by a developer certificate issued by Apple for distribution' in signature.stdout
    assert 'Notarization: trusted by the Apple notary service' in signature.stdout
    assert 'Signed with a trusted timestamp on:' in signature.stdout
    assert 'Developer ID Installer: Swift Open Source (V9AUD2URP3)' in signature.stdout
    assert 'Apple Root CA' in signature.stdout
    FACTS['packageSignatureTrusted'] = True
    expanded = CACHE / 'expanded'
    assert not expanded.exists(), 'Do not merge or overwrite an old toolchain'
    run('private-expand-full', ['/usr/sbin/pkgutil', '--expand-full', PACKAGE, expanded], timeout=600)
    compiler = expanded / 'swift-6.4.1-RELEASE-osx-package.pkg/Payload/usr/bin/swiftc'
    toolchain = compiler.parents[2]
    assert compiler.exists() and compiler.resolve().is_relative_to(expanded.resolve())
    FACTS['toolchainRoot'] = str(toolchain)
    archives = {}
    for name in ['Concurrency', '56', 'Packs']:
        archive = toolchain / ('usr/lib/swift/macosx/libswiftCompatibility' + name + '.a')
        actual = run('compatibility-' + name, ['/usr/bin/lipo', '-archs', archive])
        assert 'x86_64' in actual.stdout.split(), 'Whole official archive is missing x86_64: ' + name
        archives[name] = {'path': str(archive), 'sha256': digest(archive), 'architectures': actual.stdout.strip()}
    FACTS['actualArchives'] = archives
    for name in ['swift-driver', 'swift-frontend', 'clang']:
        run('code-signature-' + name, ['/usr/bin/codesign', '--verify', '--strict', toolchain / 'usr/bin' / name])
    # Only after complete original package signature and trust validation do any package programs run.
    run('extracted-swift-version', [compiler, '--version'])
    output = CACHE / 'private-output'
    output.mkdir(mode=0o700)
    module_cache = CACHE / 'module-cache'
    module_cache.mkdir(mode=0o700)
    child_env = {**os.environ, 'SDKROOT': str(SDK), 'CLANG_MODULE_CACHE_PATH': str(module_cache)}
    FACTS['childOnlyEnvironment'] = {'SDKROOT': str(SDK), 'CLANG_MODULE_CACHE_PATH': str(module_cache)}
    run('extracted-original-target-info', [compiler, '-target', 'x86_64-apple-macos11', '-print-target-info'], env=child_env)
    binary = output / 'zcode-window-bounds-x64-original'
    compilation = run('original-helper-compile', [compiler, '-O', '-target', 'x86_64-apple-macos11', SOURCE, '-o', binary], env=child_env, timeout=300, check=False)
    FACTS['originalCompileExitCode'] = compilation.returncode
    FACTS['originalOutputExists'] = binary.exists()
    if compilation.returncode == 0:
        assert binary.is_file()
        arch = run('helper-architecture', ['/usr/bin/lipo', '-archs', binary])
        assert arch.stdout.strip() == 'x86_64'
        load = run('helper-load-commands', ['/usr/bin/otool', '-l', binary])
        dependencies = run('helper-dependencies', ['/usr/bin/otool', '-L', binary])
        FACTS['binary'] = {'path': str(binary), 'sha256': digest(binary), 'bytes': binary.stat().st_size}
        FACTS['status'] = 'compiled-private-original-flags; not product-packaged or helper runtime acceptance'
    else:
        FACTS['status'] = 'original-helper-compile-failed-with-full-official-toolchain'
    assert digest(SOURCE) == SOURCE_SHA
    FACTS['originalSourceSha256Unchanged'] = True
except BaseException as error:
    FACTS['failure'] = str(error)
    raise
finally:
    FACTS['finishedAt'] = time.time()
    (EVIDENCE / 'full-toolchain-probe-result.json').write_text(json.dumps(FACTS, indent=2) + '\n')

raise SystemExit(0 if FACTS.get('originalCompileExitCode') == 0 else 1)
