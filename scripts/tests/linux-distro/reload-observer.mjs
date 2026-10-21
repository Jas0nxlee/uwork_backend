// 仅自有容器内只读 /proc 和 cgroup；不读环境或业务文件，不改变被观测进程。
import fs from "node:fs";
const roles = JSON.parse(process.argv[1]);
const target = "/opt/UWork Preview/zcode-preview";
const output = "/work/reload-passive.jsonl";
function read(path) {
  try {
    return fs.readFileSync(path, "utf8").trim();
  } catch (error) {
    return { unavailable: error.code };
  }
}
function sample() {
  const processes = [];
  for (const pid of fs
    .readdirSync("/proc")
    .filter((value) => /^\d+$/.test(value))) {
    const base = "/proc/" + pid;
    try {
      if (fs.readlinkSync(base + "/exe") !== target) continue;
      const stat = read(base + "/stat");
      const birth = stat.split(") ").slice(1).join(") ").split(/\s+/)[19];
      const role =
        roles.find((row) => row.id === Number(pid) && row.birth === birth)
          ?.type ?? "not-yet-bound-to-CDP-role";
      const threads = fs.readdirSync(base + "/task").map((tid) => ({
        tid: Number(tid),
        stat: read(base + "/task/" + tid + "/stat"),
        wchan: read(base + "/task/" + tid + "/wchan"),
      }));
      const after = read(base + "/stat");
      const afterBirth = after.split(") ").slice(1).join(") ").split(/\s+/)[19];
      processes.push({
        pid: Number(pid),
        role,
        birth,
        stableBirth: birth === afterBirth,
        stat,
        status: read(base + "/status"),
        wchan: read(base + "/wchan"),
        threads,
      });
    } catch (error) {
      processes.push({
        pid: Number(pid),
        unavailable: error.code ?? error.name,
      });
    }
  }
  const cgroup = {};
  for (const file of [
    "memory.events",
    "memory.events.local",
    "memory.current",
    "memory.peak",
    "memory.max",
    "memory.swap.current",
    "memory.swap.max",
    "pids.current",
    "pids.max",
  ])
    cgroup[file] = read("/sys/fs/cgroup/" + file);
  fs.appendFileSync(
    output,
    JSON.stringify({
      wallTime: Date.now(),
      uptime: read("/proc/uptime"),
      meminfo: read("/proc/meminfo"),
      cgroup,
      processes,
    }) + "\n",
  );
}
sample();
setInterval(sample, 1000);
