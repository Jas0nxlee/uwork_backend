# Native RPM and pacman acceptance

This slice uses the normal `linux-native-packaging-v10-20261020/input` payload
at commit `1db59c77`. Its Agent is
`cdf781ecf004b9639157fae25e6e96e558b95faefaee7aab09488d5dc650ecac`.
The earlier v9 four-format payload is historical evidence only.

## Ordered acceptance

1. Verify the official Fedora AArch64 OCI image against its signed checksum,
   and the official Arch Linux ARM AArch64 rootfs against its detached signature.
   Record the exact image/rootfs hashes and distribution package versions.
2. During the coordinator's compression window, run the unchanged original
   native builder once for `rpm`, then once for `pacman`, with v10 inputs.
   Compare all five runtime files with the current `expected.json`.
3. Build separate Fedora and Arch Linux ARM consumer images. Use `dnf install`
   and `pacman -U`, respectively, with original local package bytes. Resolve
   dependencies through each distribution's signed repositories. Do not use
   `--nodeps`, extract UWork as a substitute for installation, or disable
   repository signature verification.
4. Run one GUI at a time as UID/GID 1000 with a new owned profile. Exercise the
   original installed executable, its bundled Agent, backend business requests,
   PTY and file paths, and system URI cancel/confirm/concurrent delivery. Record
   the real package owner, desktop registration, flags and process identities.
   The temporary outer container may allow user namespaces while keeping
   cap-drop ALL and no-new-privileges. Do not add a product `--no-sandbox` flag.
5. After the owned app exits, uninstall with `dnf remove` or `pacman -R`.
   Verify the package DB, owned file manifest, executable/alternatives links,
   system desktop/MIME registration and permissions. Distinguish intentional
   user profile retention from stale installed program files. Remove all owned
   containers, networks and transient volumes and prove their absence.

This is distribution userspace acceptance inside the dedicated Linux VM, not
physical Fedora/Arch desktop, systemd boot, Wayland, all CPU architectures,
signed publication, or a complete update feed. Real WeCom browser authorization,
external MCP and cloud drives remain outside this slice.

## Official trust sources

- [Fedora container downloads](https://fedoraproject.org/en/misc/): Fedora 44
  AArch64 Container Base OCI archive, signed CHECKSUM, `fedora.gpg`; the same page
  identifies `quay.io/fedora/fedora` as Fedora's registry.
- [Arch Linux ARM downloads](https://archlinuxarm.org/about/downloads): AArch64
  multi-platform rootfs and detached signature; signing fingerprint
  `68B3537F39A313B3E574D06777193F152BDBE6A6`.
- [Arch Linux ARM package signing](https://archlinuxarm.org/about/package-signing):
  initialize and populate the original keyring; repository packages remain
  `SigLevel = Required DatabaseOptional`, local files use the distribution's
  documented `LocalFileSigLevel = Optional` for this unsigned local UWork build.
- [Arch Linux ARM mirrors](https://archlinuxarm.org/about/mirrors): official
  mirror service. `os.archlinuxarm.org` and `mirror.archlinuxarm.org` had HTTPS
  hostname mismatches during preparation. The CA/US official mirror passed TLS
  and serves the same signed rootfs. No TLS verification bypass is permitted.

Preparation records are not test passes. Compression and GUI execution require
the coordinator's explicit resource window; VM lifecycle belongs to that owner.

## Driver adaptation boundary

`run.py` executes the existing renderer/business/PTY/protocol acceptance through
its original browser harness. Its explicit fixture adaptations are recorded
with before/after text or SHA: the installed-package observation invokes real
`rpm -q` or `pacman -Q`, and the compiled backend fixture omits its existing
`--no-sandbox` launch argument. The shared driver/backend files and package bytes
remain untouched. The temporary outer container alone uses
`seccomp=unconfined`, UID/GID 1000, cap-drop ALL and no-new-privileges; it samples
real kernel fields and requires renderer Seccomp=2 with nested user/PID namespaces.
The initial install transaction occurs in the consumer image build. The runtime
uses that exact installed image read-only; a separate disposable clone performs
the uninstall transaction. This proves the same installed payload's lifecycle,
not a single writable container's install/run/remove sequence.


Current evidence distinguishes Fedora's ten business checks and positive original
sandbox observations from the failed xdg generic dispatch. Chromium renderer
roles come from original browser-target SystemInfo.getProcessInfo, followed by
fresh cap-zero UID1000 proc snapshots with stable start ticks. The ready and
pre-Chat gates are read-only additions to the fixture, with exact anchor changes
recorded; inherited zygote argv is never treated as a renderer role. Reload gets
timestamps only. No packaged source or flags are changed beyond removing the
fixture's original no-sandbox flag.

The original Fedora remove found the vendor alternatives target mismatch and
unowned empty directories. The project RPM-only hook was fixed with 11 permanent
tests and a normally produced new RPM; a separate same-version DNF reinstall /
remove transaction proves the native installed hook and full cleanup. See
`docs/client-linux-rpm-uninstall-fix-test-2026-10-20.md`. This is not renamed as a
fresh installation or a new-RPM GUI pass. Reproduce just the real PM slice with
`python3 scripts/tests/linux-distro/run-fixed-rpm.py --name <new-case-name>`.

Arch's original pacman sandbox needs inherited NoNewPrivs in this bounded Docker
root environment: use the system setpriv --no-new-privs, retaining Landlock,
original signatures, TLS and timeout. Five parallel upstream downloads hit
signature-file low-speed failures even with one finite in-RUN cache retry. A
subsequent consumer preparation sets only ParallelDownloads=1 after small-file
TLS diagnosis, retaining every validation. Preparation/download progress is not
an installation pass.


`run.py --usage-isolation` extends only the owned fixture at one exact source
anchor before the normal esbuild bundle. Original HTTP creates/password-authenticates
a second ordinary member. After real Desktop calls settle, both members use
`/api/client/usage`; the second member and its foreign `userId` query remain empty,
and both ordinary members are refused the management usage API. After original
seat revocation, the first member receives NO_SEAT while the second remains
authorized and empty. No DB/state injection or replacement of product usage
handlers occurs. The shared backend/probe and installed archive stay unchanged.
The existing fixture no-sandbox removal remains exactly once after this build.

`--business-without-reload` is a separate scoped acceptance path after the
retained Arch v2 reload/CDP timeout. Both result files explicitly record the
omission, and no reload check is marked passed. It preserves File/PTY/model/
usage/revocation/system-URI assertions to isolate these paths without claiming
the original full acceptance passed or repairing the reload failure.

`--reload-diagnostics` retains the original reload, budgets and sandbox and records
read-only original CDP roles bound to PID birth, per-second proc/thread/cgroup
observations, and three-second local version/list receipts. One allowed Arch
diagnostic run did not reproduce the historical intermittent CDP freeze; it
passed ten original checks but still failed system URI dispatch. Its 38 samples
with zero OOM counters apply only to that current run. The earlier failed runs
remain unroot-caused. No further case is implied or scheduled by this option.
