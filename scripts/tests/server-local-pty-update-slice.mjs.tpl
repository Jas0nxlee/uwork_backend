// Only fixed local shell commands flow through the original public Terminal SDK.
async function localGuard(status, services, phase) {
  const keys = [
    "HOME",
    "USERPROFILE",
    "ZCODE_DESKTOP_HOME_DIR",
    "UWORK_DATA_BASE_DIR",
    "ZCODE_DATA_BASE_DIR",
    "ZCODE_STORAGE_DIR",
    "ZCODE_SERVER_ROOT",
  ];
  const raw =
    process.platform === "linux"
      ? await readFile(`/proc/${status.pid}/environ`, "utf8")
      : execFileSync(
          "/bin/ps",
          ["eww", "-p", String(status.pid), "-o", "command="],
          { encoding: "utf8" },
        );
  const profile = {};
  for (const key of keys) {
    profile[key] =
      process.platform === "linux"
        ? raw
            .split("\0")
            .find((x) => x.startsWith(key + "="))
            ?.slice(key.length + 1)
        : raw.match(new RegExp("(?:^|\\s)" + key + "=([^\\s]+)"))?.[1];
    assert.equal(
      profile[key],
      key === "ZCODE_STORAGE_DIR" ? root + "/.uwork" : root,
    );
  }
  const info = await bounded(
    services.systemService.info(),
    10000,
    "SDK private homedir",
  );
  assert.equal(info.homedir, root);
  assert.equal((await httpInfo(status)).version, "3.16.0");
  facts.profileGuards ??= [];
  facts.profileGuards.push({
    phase,
    corePid: status.pid,
    profile,
    SDKHomedir: info.homedir,
    guardedBeforeBusinessWrite: true,
  });
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function waitGone(pid) {
  for (let i = 0; i < 100 && alive(pid); i++) await delay(50);
  assert.equal(alive(pid), false, "owned shell must be reaped");
}
async function terminalSlice(status, services, phase, expectedBad = false) {
  const t = services.terminalService;
  const created = await bounded(
    t.create({ cols: 80, rows: 24, cwd: workspacePath }),
    15000,
    "original SDK terminal create",
  );
  let output = "",
    shellPid;
  const subscription = t.onDynamicData(created.id)((chunk) => {
    output += chunk;
  });
  const row = {
    phase,
    id: created.id,
    expectedHistoricalRed: expectedBad,
    sizes: [],
  };
  facts.terminals ??= [];
  facts.terminals.push(row);
  const clean = () =>
    output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r/g, "");
  async function until(pattern, label) {
    const end = performance.now() + 10000;
    while (performance.now() < end) {
      const m = clean().match(pattern);
      if (m) return m;
      await delay(30);
    }
    throw new Error("Original PTY observation timeout: " + label);
  }
  try {
    await t.write({
      id: created.id,
      data: "printf '\\n__OWNED_ID__%s|' \"$$\"; printf '%s|' \"$PWD\"; tty\r",
    });
    const id = await until(
      /^__OWNED_ID__(\d+)\|([^\n|]+)\|([^\n]+)$/m,
      "shell identity",
    );
    shellPid = Number(id[1]);
    pids.add(shellPid);
    assert.ok(shellPid > 1);
    assert.equal(id[2], workspacePath);
    assert.match(id[3], /^\/dev\//);
    row.identity = { pid: shellPid, cwd: id[2], tty: id[3] };
    if (process.platform === "linux") {
      assert.equal(await readlink(`/proc/${shellPid}/cwd`), workspacePath);
      assert.equal(await readlink(`/proc/${shellPid}/fd/0`), id[3]);
      assert.match(
        await readFile(`/proc/${shellPid}/status`, "utf8"),
        /^Uid:\s+1000\s+1000\s+1000\s+1000$/m,
      );
    } else {
      const observation = execFileSync(
        "/usr/sbin/lsof",
        ["-a", "-p", String(shellPid), "-d", "cwd,0", "-Fn"],
        { encoding: "utf8" },
      );
      assert.ok(observation.includes("n" + workspacePath));
      assert.ok(observation.includes("n" + id[3]));
      row.osIdentityVerified = true;
    }
    const mapped =
      process.platform === "linux"
        ? await readFile(`/proc/${status.pid}/maps`, "utf8")
        : execFileSync(
            "/usr/sbin/lsof",
            ["-p", String(status.pid), "-d", "txt", "-Fn"],
            { encoding: "utf8" },
          );
    const paths = [
      ...new Set(
        mapped
          .split("\n")
          .map((line) =>
            process.platform === "linux"
              ? line.slice(line.indexOf("/"))
              : line.slice(1),
          )
          .filter((path) =>
            phase === "new-initial"
              ? path ===
                launcher.slice(0, -"/bin/zcode".length) +
                  "/runtime/node_modules/node-pty/prebuilds/" +
                  metadata.new.target +
                  "/pty.node"
              : path.startsWith(root + "/releases/") &&
                path.endsWith("/pty.node"),
          ),
      ),
    ];
    assert.equal(paths.length, 1);
    const nativeSha256 = createHash("sha256")
      .update(await readFile(paths[0]))
      .digest("hex");
    assert.equal(
      nativeSha256,
      metadata[phase === "old" ? "old" : "new"].nativeSha256,
    );
    row.native = { path: paths[0], sha256: nativeSha256 };
    if (expectedBad) {
      let rejection;
      try {
        await t.resize({ id: created.id, cols: 91, rows: 37 });
      } catch (error) {
        rejection = String(error);
      }
      row.historicalError = rejection;
      assert.match(
        rejection ?? "",
        /^(?:Error: )?Usage: pty\.resize\(fd, cols, rows, xPixel, yPixel\)$/,
        "exact historical Linux five-argument Usage signature",
      );
    } else
      for (const [rows, cols, tag] of [
        [37, 91, "A"],
        [44, 113, "B"],
      ]) {
        await t.resize({ id: created.id, cols, rows });
        await t.write({
          id: created.id,
          data: `printf '\\n__SIZE_${tag}__'; stty size; printf '__DONE_${tag}__\\n'\r`,
        });
        const size = await until(
          new RegExp(
            "^__SIZE_" + tag + "__(\\d+)\\s+(\\d+)\\n__DONE_" + tag + "__$",
            "m",
          ),
          "stty " + tag,
        );
        assert.equal(Number(size[1]), rows);
        assert.equal(Number(size[2]), cols);
        assert.ok(alive(shellPid));
        row.sizes.push({ rows, cols });
      }
    await t.write({
      id: created.id,
      data: "printf '\\n__OWNED_END__%s|' \"$$\"; printf '%s|' \"$PWD\"; tty\r",
    });
    const end = await until(
      /^__OWNED_END__(\d+)\|([^\n|]+)\|([^\n]+)$/m,
      "unchanged identity",
    );
    assert.deepEqual(end.slice(1), id.slice(1));
    row.sameShellIdentity = true;
  } finally {
    await bounded(t.dispose({ id: created.id }), 10000, "original SDK dispose");
    subscription.dispose();
    if (shellPid) await waitGone(shellPid);
    row.disposed = true;
  }
  facts.checks.push(
    phase +
      (expectedBad
        ? "-original-linux-known-ABI5-RED-confirmed"
        : "-public-sdk-two-resizes-real-stty"),
  );
}
let workspacePath;
const ownedContent = "# UWORK_LOCAL_PTY_UPDATE_OWNED_20261020\nowned-pty/**\n";
async function persisted(services, phase) {
  const settings = await services.settingService.get();
  assert.equal(settings.locale, "en-US");
  assert.equal(settings.terminalInheritSystemProfile, false);
  const file = await services.fileService.readTextFile({
    path: workspacePath + "/.zcodeignore",
  });
  assert.equal(file.content, ownedContent);
  facts.checks.push(phase + "-original-file-setting-persisted");
}
const deadline = setTimeout(() => {
  throw new Error("Owned local PTY lifecycle deadline");
}, 230000);
try {
  assert.equal(process.version, "v22.16.0");
  assert.equal(process.arch, "arm64");
  assert.equal(process.platform, metadata.new.target.split("-")[0]);
  await mkdir(env.HOME, { recursive: true });
  await mkdir(env.TMPDIR, { recursive: true });
  const boot = await cli(["serve", "--daemon"]);
  assert.equal(boot.state, "ready");
  assert.equal(boot.serviceRegistered, false);
  pids.add(JSON.parse(await readFile(root + "/run/server.lock", "utf8")).pid);
  let current = boot,
    connection = await connect(current, "new-initial");
  await localGuard(current, connection.services, "new-initial");
  workspacePath = (
    await connection.services.fileService.ensureConversationWorkspace()
  ).path;
  assert.equal(workspacePath, root + "/.uwork/workspace/default");
  await connection.services.settingService.update({
    locale: "en-US",
    terminalInheritSystemProfile: false,
  });
  await connection.services.fileService.writeWorkspaceFileSearchIgnore({
    rootPath: workspacePath,
    content: ownedContent,
  });
  await terminalSlice(current, connection.services, "new-initial");
  for (const which of ["old", "new"]) {
    release(which);
    assert.equal((await cli(["update"])).applied, true);
    await bounded(
      connection.closed,
      15000,
      "original update closes old socket",
    );
    current = await ready(current.pid);
    const installed = JSON.parse(
      await readFile(root + "/current.json", "utf8"),
    );
    assert.equal(installed.archiveSha256, metadata[which].sha256);
    connection = await connect(current, which);
    await localGuard(current, connection.services, which);
    await persisted(connection.services, which);
    await terminalSlice(
      current,
      connection.services,
      which,
      which === "old" && process.platform === "linux",
    );
  }
  launcher = root + "/bin/zcode";
  await cli(["stop"]);
  await bounded(connection.closed, 15000, "original stop closes socket");
  await delay(12000);
  assert.equal((await cli(["status"])).state, "stopped");
  const removal = await cli(["uninstall"]);
  assert.equal(removal.uninstalled, true);
  facts.checks.push("original-stop-no-respawn-12s-double-confirm-uninstall");
  facts.status = "passed";
