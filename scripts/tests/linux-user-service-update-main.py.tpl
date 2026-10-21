    catalog_server = None
    catalog_thread = None
    catalog_url = None
    unit_links = registered_unit_links(str(Path.home()), os.environ.get('XDG_CONFIG_HOME'), unit)

    def observe_process(pid, role):
        assert type(pid) is int and pid > 1
        proc = Path('/proc') / str(pid)
        first = (proc / 'stat').read_text().rsplit(') ', 1)[1].split()[19]
        executable = os.readlink(proc / 'exe')
        assert executable.startswith(str(bootstrap) + '/') or executable.startswith(str(root / 'releases') + '/')
        raw_status = dict(line.split(':', 1) for line in (proc / 'status').read_text().splitlines() if ':' in line)
        fields = {key: raw_status[key].strip() for key in ['Uid', 'Gid', 'PPid', 'CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb', 'NoNewPrivs', 'Seccomp'] if key in raw_status}
        assert fields['Uid'].split() == [str(os.getuid())] * 4 and os.getuid() == 501
        cgroup = (proc / 'cgroup').read_text()
        second = (proc / 'stat').read_text().rsplit(') ', 1)[1].split()[19]
        assert first == second and os.readlink(proc / 'exe') == executable
        return {'pid': pid, 'role': role, 'birth': first, 'exe': executable, 'fields': fields, 'cgroup': cgroup}

    def registered_phase(status, phase, previous_main=None):
        state = owned_descriptor()
        assert state['ActiveState'] == 'active' and state['SubState'] == 'running'
        assert status['state'] == 'ready' and status['serviceRegistered'] is True
        main = observe_process(int(state['MainPID']), 'systemd-supervisor')
        core = observe_process(status['pid'], 'core')
        assert int(core['fields']['PPid']) == main['pid']
        assert state['ControlGroup'].startswith('/')
        for row in [main, core]:
            assert any(line.rsplit(':', 1)[-1] == state['ControlGroup'] or line.rsplit(':', 1)[-1].startswith(state['ControlGroup'] + '/') for line in row['cgroup'].splitlines())
        if previous_main is not None:
            assert all(main[key] == previous_main[key] for key in ['pid', 'birth', 'exe', 'cgroup'])
        row = {'phase': phase, 'unit': state, 'supervisor': main, 'core': core, 'descriptorSha256': hashlib.sha256(descriptor.read_bytes()).hexdigest()}
        facts.setdefault('registeredUpdatePhases', []).append(row)
        return row

    def start_catalog():
        nonlocal catalog_server, catalog_thread, catalog_url
        assert catalog_server is None
        item = metadata['archives']['new']
        class OwnedCatalog(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_GET(self):
                row = {'method': 'GET', 'path': self.path}
                facts.setdefault('catalogReceipts', []).append(row)
                if self.path == '/catalog.json':
                    data = json.dumps(registered_catalog_document(catalog_url.removesuffix('/catalog.json'), item)).encode()
                    self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
                    row.update(status=200, bytes=len(data))
                elif self.path == '/new.tar.gz':
                    self.send_response(200); self.send_header('Content-Length', str(item['bytes'])); self.end_headers()
                    with (source / 'new.tar.gz').open('rb') as stream:
                        shutil.copyfileobj(stream, self.wfile)
                    row.update(status=200, bytes=item['bytes'], sha256=item['sha256'])
                else:
                    self.send_error(404); row['status'] = 404
        catalog_server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), OwnedCatalog)
        catalog_server.daemon_threads = True
        ports.add(catalog_server.server_port)
        catalog_url = 'http://127.0.0.1:' + str(catalog_server.server_port) + '/catalog.json'
        catalog_thread = threading.Thread(target=catalog_server.serve_forever, daemon=True)
        catalog_thread.start()

    def close_catalog():
        if catalog_server is not None:
            catalog_server.shutdown(); catalog_server.server_close(); catalog_thread.join(timeout=3)
            assert not catalog_thread.is_alive(), 'Owned catalog thread must reap'

    watcher = None
    def start_original_socket_watch(status):
        nonlocal watcher
        watcher = subprocess.Popen([str(node), str(source / 'sdk.mjs'), str(status['port']), str(root), 'watch', str(status['pid']), str(os.getuid()), metadata['archives']['new']['members']['runtime/node_modules/node-pty/prebuilds/linux-arm64/pty.node']], env=env, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        pids.add(watcher.pid)
        assert select.select([watcher.stdout], [], [], 8)[0], 'Original SDK watch did not connect'
        line = watcher.stdout.readline()
        ready_watch = json.loads(line)
        assert ready_watch['watchReady'] is True and ready_watch['SDKHomedir'] == str(root)
        facts['originalSocketWatch'] = {'ready': ready_watch}

    def finish_original_socket_watch():
        output, error = watcher.communicate(timeout=20)
        rows = [json.loads(line) for line in output.splitlines() if line.startswith(b'{')]
        facts['originalSocketWatch'].update(exitCode=watcher.returncode, result=rows[-1] if rows else None, stderr=error.decode()[-1200:])
        assert watcher.returncode == 0 and rows[-1]['watchedOriginalClose'] is True
        assert rows[-1]['close']['wasClean'] is True

    def close_original_socket_watch():
        if watcher is not None and watcher.poll() is None:
            try:
                watcher.communicate(timeout=3)
            except subprocess.TimeoutExpired:
                watcher.kill(); watcher.communicate(timeout=3)
