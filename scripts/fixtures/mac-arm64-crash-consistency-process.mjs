/** Owned test process boundaries only; never authorizes signals from argv or a PID alone. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import { open } from "node:fs/promises";
const run = promisify(execFile);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function ps(args) {
  try {
    return (
      await run("/bin/ps", args, {
        timeout: 1500,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, LC_ALL: "C" },
      })
    ).stdout;
  } catch (error) {
    if (error.code === 1 && !error.stdout && !error.stderr) return "";
    throw error;
  }
}
export async function readCrashProcessTable() {
  const text = await ps(["-axo", "pid=,ppid=,pgid="]);
  const rows = text
    .trim()
    .split("\n")
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/);
      assert.ok(match, "Exact PID/parent/group process metadata required");
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        pgid: Number(match[3]),
      };
    });
  assert.ok(rows.length < 20000);
  return rows;
}
export async function readCrashProcessIdentity(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 1);
  const text = (await ps(["-p", String(pid), "-o", "lstart=,comm="])).trim();
  if (!text) return null;
  const match = text.match(
    /^(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/,
  );
  assert.ok(match, "Birth and executable metadata required");
  let output;
  try {
    output = await run(
      "/usr/sbin/lsof",
      ["-nP", "-a", "-p", String(pid), "-d", "txt", "-Fn"],
      { timeout: 1500, maxBuffer: 2 * 1024 * 1024 },
    );
  } catch (error) {
    if (
      error.code === 1 &&
      !(await ps(["-p", String(pid), "-o", "lstart=,comm="])).trim()
    )
      return null;
    throw error;
  }
  const textFiles = [
    ...new Set(
      output.stdout
        .split("\n")
        .filter((line) => line.startsWith("n/"))
        .map((line) => line.slice(1)),
    ),
  ];
  assert.ok(textFiles.length && textFiles.length < 256);
  assert.equal(
    (await ps(["-p", String(pid), "-o", "lstart=,comm="])).trim(),
    text,
    "Process changed while inspecting mapped executable",
  );
  // comm can be an argv/title diagnostic. proc_pidpath is the kernel executable authority; never probe unrelated txt files.
  const kernelReader =
    "import ctypes,json,sys; lib=ctypes.CDLL('/usr/lib/libproc.dylib',use_errno=True); fn=lib.proc_pidpath; fn.argtypes=[ctypes.c_int,ctypes.c_void_p,ctypes.c_uint32]; fn.restype=ctypes.c_int; buf=ctypes.create_string_buffer(4096); n=fn(int(sys.argv[1]),buf,4096); print(json.dumps({'path':buf.value.decode('utf-8') if n>0 else None,'errno':ctypes.get_errno() if n<=0 else 0}))";
  const observed = JSON.parse(
    (
      await run("/usr/bin/python3", ["-I", "-c", kernelReader, String(pid)], {
        timeout: 1500,
        maxBuffer: 8192,
      })
    ).stdout,
  );
  if (
    observed.errno === 3 &&
    !(await ps(["-p", String(pid), "-o", "lstart=,comm="])).trim()
  )
    return null;
  assert.equal(observed.errno, 0, "Kernel executable path read failed");
  const executable = observed.path;
  assert.ok(
    typeof executable === "string" &&
      executable.startsWith("/") &&
      textFiles.includes(executable),
    "Kernel absolute executable must exactly match a live txt mapping",
  );
  const handle = await open(executable, "r");
  try {
    const head = Buffer.alloc(32);
    const first = await handle.read(head, 0, 32, 0);
    assert.ok(first.bytesRead >= 16, "Executable header must be available");
    let offset = 0;
    if (head.readUInt32BE(0) === 0xcafebabe) offset = head.readUInt32BE(16);
    else if (head.readUInt32BE(0) === 0xcafebabf)
      offset = Number(head.readBigUInt64BE(16));
    if (offset) {
      const slice = await handle.read(head, 0, 16, offset);
      assert.equal(slice.bytesRead, 16);
    }
    assert.ok(
      [0xfeedfacf, 0xfeedface].includes(head.readUInt32LE(0)) &&
        head.readUInt32LE(12) === 2,
      "Kernel-reported image must be actual MH_EXECUTE",
    );
  } finally {
    await handle.close();
  }
  assert.equal(
    (await ps(["-p", String(pid), "-o", "lstart=,comm="])).trim(),
    text,
    "Process changed while selecting executable image",
  );
  return {
    pid,
    birth: match[1],
    commandName: match[2],
    executable,
    mappedTextFiles: textFiles,
  };
}
const system = {
  table: readCrashProcessTable,
  identity: readCrashProcessIdentity,
  signal: (pid, signal) => process.kill(pid, signal),
  sleep,
  now: () => performance.now(),
};
function sameIdentity(a, b) {
  return (
    !!b &&
    a.pid === b.pid &&
    a.birth === b.birth &&
    a.commandName === b.commandName &&
    a.executable === b.executable &&
    b.mappedTextFiles.includes(a.executable)
  );
}
function assertCapturedTable(captured, table) {
  const expected = new Set(captured.map((row) => row.pid));
  for (const row of captured) {
    const current = table.find((value) => value.pid === row.pid);
    assert.ok(
      current && current.ppid === row.ppid && current.pgid === row.pgid,
      "Captured parent/group relationship changed",
    );
  }
  assert.ok(
    table.every((row) => !expected.has(row.ppid) || expected.has(row.pid)),
    "Owned descendant set changed before signal",
  );
}
export async function captureCrashGeneration(
  {
    child,
    executable,
    requiredPids = [],
    forbiddenPids = [process.pid, process.ppid, 92288],
  },
  boundary = system,
) {
  assert.ok(
    child &&
      Number.isSafeInteger(child.pid) &&
      child.pid > 1 &&
      child.exitCode === null &&
      child.signalCode === null,
  );
  assert.ok(executable.startsWith("/") && requiredPids.length <= 64);
  const deadline = boundary.now() + 15000;
  const withinBudget = () =>
    assert.ok(boundary.now() < deadline, "Crash capture budget exhausted");
  const rows = (await boundary.table()).map((row) => ({ ...row }));
  withinBudget();
  const main = rows.find((row) => row.pid === child.pid);
  assert.ok(
    main && main.pgid === child.pid && !forbiddenPids.includes(main.pid),
    "Only original owned Main process-group leader",
  );
  const owned = new Set([main.pid]);
  for (let round = 0; round < 64; round++) {
    const before = owned.size;
    for (const row of rows) if (owned.has(row.ppid)) owned.add(row.pid);
    assert.ok(
      owned.size <= 64,
      "Owned generation exceeds bounded process inventory",
    );
    if (owned.size === before) break;
  }
  assert.ok(
    requiredPids.every((pid) => owned.has(pid)),
    "Every observed CLI/PTY must still be a Main descendant",
  );
  assert.ok(
    rows
      .filter((row) => row.pgid === main.pgid)
      .every((row) => owned.has(row.pid)),
    "Main group contains an unowned process",
  );
  const captured = [];
  for (const row of rows.filter((row) => owned.has(row.pid))) {
    assert.ok(!forbiddenPids.includes(row.pid));
    withinBudget();
    const identity = await boundary.identity(row.pid);
    withinBudget();
    assert.ok(identity && identity.pid === row.pid);
    const mappedExecutable =
      row.pid === main.pid ? executable : identity.executable;
    assert.ok(
      identity.executable === mappedExecutable &&
        identity.mappedTextFiles.includes(mappedExecutable),
      "Actual executable identity must match authorized image",
    );
    captured.push({
      ...row,
      birth: identity.birth,
      commandName: identity.commandName,
      executable: mappedExecutable,
    });
  }
  const after = await boundary.table();
  withinBudget();
  assertCapturedTable(captured, after);
  const finalMain = await boundary.identity(child.pid);
  withinBudget();
  assert.ok(
    sameIdentity(
      captured.find((row) => row.pid === child.pid),
      finalMain,
    ),
  );
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);
  return {
    mainPid: main.pid,
    groupId: main.pgid,
    rows: captured,
    requiredPids: [...requiredPids],
  };
}
export async function crashOwnedMain(
  { child, executable, requiredPids, onCaptured },
  boundary = system,
) {
  // Capture all detached descendants for later observation, then revalidate the exact leader/group immediately before the signal.
  const deadline = boundary.now() + 30000;
  const withinBudget = () =>
    assert.ok(boundary.now() < deadline, "Crash prekill budget exhausted");
  const capture = await captureCrashGeneration(
    { child, executable, requiredPids },
    boundary,
  );
  if (onCaptured) await onCaptured(capture);
  withinBudget();
  const current = await boundary.identity(child.pid);
  assert.ok(
    sameIdentity(
      capture.rows.find((row) => row.pid === child.pid),
      current,
    ),
  );
  const table = await boundary.table();
  assert.ok(table.find((row) => row.pid === child.pid)?.pgid === child.pid);
  assert.ok(
    table
      .filter((row) => row.pgid === child.pid)
      .every((row) => capture.rows.some((owned) => owned.pid === row.pid)),
    "Group membership changed before SIGKILL",
  );
  for (const row of table.filter((row) => row.pgid === child.pid)) {
    assert.ok(
      sameIdentity(
        capture.rows.find((owned) => owned.pid === row.pid),
        await boundary.identity(row.pid),
      ),
      "Group member identity changed before SIGKILL",
    );
    withinBudget();
  }
  const finalMain = await boundary.identity(child.pid);
  assert.ok(
    sameIdentity(
      capture.rows.find((row) => row.pid === child.pid),
      finalMain,
    ),
  );
  const finalTable = await boundary.table();
  withinBudget();
  assertCapturedTable(capture.rows, finalTable);
  assert.ok(
    finalTable.find((row) => row.pid === child.pid)?.pgid === child.pid,
  );
  assert.deepEqual(
    finalTable
      .filter((row) => row.pgid === child.pid)
      .map((row) => row.pid)
      .sort(),
    table
      .filter((row) => row.pgid === child.pid)
      .map((row) => row.pid)
      .sort(),
  );
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);
  let timer, exited;
  const exit = new Promise((done, reject) => {
    exited = (code, signal) => done({ code, signal });
    child.once("exit", exited);
    timer = setTimeout(
      () => reject(Error("Owned crash exit not observed within5s")),
      5000,
    );
  });
  try {
    withinBudget();
    boundary.signal(-child.pid, "SIGKILL");
    const observed = await exit;
    assert.deepEqual(observed, { code: null, signal: "SIGKILL" });
    return {
      capture,
      exit: observed,
      method: "owned Main PGID SIGKILL; not TERM or UI quit",
    };
  } finally {
    clearTimeout(timer);
    child.off("exit", exited);
  }
}
export async function cleanupCapturedCrashGeneration(
  capture,
  boundary = system,
) {
  const receipt = {
    residualBeforeCleanup: [],
    signals: [],
    unsafe: [],
    absent: false,
  };
  for (const row of [...capture.rows].reverse()) {
    const current = await boundary.identity(row.pid);
    if (!current) continue;
    receipt.residualBeforeCleanup.push(row.pid);
    if (!sameIdentity(row, current)) {
      receipt.unsafe.push(row.pid);
      continue;
    }
    try {
      boundary.signal(row.pid, "SIGTERM");
      receipt.signals.push({ pid: row.pid, signal: "SIGTERM" });
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  const deadline = boundary.now() + 2000;
  while (boundary.now() < deadline) {
    if (
      (
        await Promise.all(capture.rows.map((row) => boundary.identity(row.pid)))
      ).every((row) => !row)
    )
      break;
    await boundary.sleep(100);
  }
  for (const row of [...capture.rows].reverse()) {
    const current = await boundary.identity(row.pid);
    if (!current) continue;
    if (!sameIdentity(row, current)) {
      if (!receipt.unsafe.includes(row.pid)) receipt.unsafe.push(row.pid);
      continue;
    }
    try {
      boundary.signal(row.pid, "SIGKILL");
      receipt.signals.push({ pid: row.pid, signal: "SIGKILL" });
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  await boundary.sleep(200);
  receipt.absent = (
    await Promise.all(capture.rows.map((row) => boundary.identity(row.pid)))
  ).every((row) => !row);
  return receipt; // This cleanup never turns a failed crash observation into a passing case.
}
