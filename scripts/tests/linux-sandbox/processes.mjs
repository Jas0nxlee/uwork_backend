import { readdir, readFile, readlink } from 'node:fs/promises';

const rows = [];
for (const pid of await readdir('/proc')) {
  if (!/^\d+$/.test(pid)) continue;
  try {
    const args = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
    let executable;
    try { executable = await readlink(`/proc/${pid}/exe`); } catch { executable = null; }
    if (!args.some((arg) => /zcode-preview$/.test(arg)) && !executable?.startsWith('/work/extract/')) continue;
    const status = await readFile(`/proc/${pid}/status`, 'utf8');
    const fields = {};
    for (const key of ['Name', 'PPid', 'Uid', 'Gid', 'NSpid', 'NoNewPrivs', 'Seccomp', 'Seccomp_filters', 'CapEff']) {
      fields[key] = status.match(new RegExp('^' + key + ':\\s*(.*)$', 'm'))?.[1];
    }
    const namespaces = {};
    for (const key of ['pid', 'user', 'mnt', 'net']) {
      try { namespaces[key] = await readlink(`/proc/${pid}/ns/${key}`); }
      catch (error) { namespaces[key] = { unavailable: error.code }; }
    }
    const maps = {};
    for (const kind of ['uid', 'gid']) {
      try { maps[kind] = await readFile(`/proc/${pid}/${kind}_map`, 'utf8'); }
      catch (error) { maps[kind] = { unavailable: error.code }; }
    }
    rows.push({ pid: Number(pid), args, executable, fields, namespaces, maps });
  } catch { /* Only currently observable owned processes are evidence. */ }
}
console.log(JSON.stringify(rows));
