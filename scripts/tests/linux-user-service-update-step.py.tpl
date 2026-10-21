        start_original_socket_watch(ready)
        start_catalog()
        assert cli('update') == {'applied': True, 'version': '3.16.0'}
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            restarted = cli('status')
            if restarted['state'] == 'ready' and restarted['pid'] != ready['pid']:
                break
            time.sleep(.2)
        finish_original_socket_watch()
        assert restarted['state'] == 'ready' and restarted['pid'] != ready['pid']
        assert restarted['generation'] == ready['generation'] + 1
        installed = json.loads((root / 'current.json').read_text())
        assert installed['archiveSha256'] == metadata['archives']['new']['sha256']
        assert installed['target'] == 'linux-arm64' and installed['version'] == '3.16.0'
        assert str(Path(installed['releaseDir']).resolve()).startswith(str(root / 'releases') + '/')
        new_phase = registered_phase(restarted, 'new-after-original-update', old_phase['supervisor'])
        assert new_phase['descriptorSha256'] == old_phase['descriptorSha256']
        assert new_phase['core']['exe'] == str(Path(installed['releaseDir']) / 'runtime/node')
        launcher = root / 'bin/zcode'
        sdk(restarted, 'updated')
        assert [row['path'] for row in facts['catalogReceipts']] == ['/catalog.json', '/new.tar.gz']
        assert all(row['status'] == 200 for row in facts['catalogReceipts'])
        facts['checks'].append('original-registered-unit-update-new-core-file-settings-native-pty')
