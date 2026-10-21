def registered_catalog_document(origin, item):
    parsed = urllib.parse.urlsplit(origin)
    assert parsed.scheme == 'http' and parsed.hostname == '127.0.0.1'
    assert parsed.port and 0 < parsed.port < 65536
    assert parsed.netloc == '127.0.0.1:' + str(parsed.port)
    assert parsed.path == '' and not parsed.query and not parsed.fragment
    assert item['target'] == 'linux-arm64' and item['version'] == '3.16.0'
    assert re.fullmatch('[0-9a-f]{64}', item['sha256'])
    assert type(item['bytes']) is int and item['bytes'] > 0
    return {'schemaVersion': 1, 'releases': [{'version': item['version'], 'target': item['target'], 'archiveUrl': origin + '/new.tar.gz', 'archiveSha256': item['sha256'], 'archiveSizeBytes': item['bytes']}]}


def registered_unit_links(home, config_home, unit):
    assert re.fullmatch(r'com\.zhipu\.zcode\.server\.[0-9a-f]{8}\.service', unit)
    base = Path(config_home) if config_home else Path(home) / '.config'
    assert base.is_absolute()
    user = base / 'systemd/user'
    return [user / unit, user / 'default.target.wants' / unit]


def registered_cli_json(stdout):
    rows = [json.loads(line) for line in stdout.splitlines() if line.startswith('{')]
    return rows[-1] if rows else None
