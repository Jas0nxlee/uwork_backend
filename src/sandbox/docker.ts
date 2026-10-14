import Docker from "dockerode";
import { PassThrough } from "node:stream";
import { ApiError, fail, now } from "../core.js";
import type {
  SandboxDriver,
  SandboxOwner,
  SandboxObservation,
  SandboxOutput,
} from "./contract.js";

const OWNER_LABEL = "uwork.sandbox-owner";
const RUNTIME_LABEL = "uwork.runtime-id";
const MANAGED_LABEL = "uwork.managed-by";
const OUTPUT_LIMIT = 128 * 1024;
function status(error: unknown, code: number) {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    error.statusCode === code
  );
}
export class DockerSandboxDriver implements SandboxDriver {
  private client: Docker;
  private imageId: string | undefined;
  constructor(
    socketPath: string,
    private imageReference: string,
  ) {
    if (!socketPath.startsWith("/") || socketPath.includes("\0"))
      throw new Error("Sandbox requires an explicit unix socket path");
    this.client = new Docker({ socketPath, timeout: 15000 });
  }
  async health() {
    try {
      await this.client.ping();
      const image = await this.client.getImage(this.imageReference).inspect();
      this.imageId = image.Id;
      return { available: true, image: image.Id };
    } catch {
      return { available: false, image: this.imageReference };
    }
  }
  private container(owner: SandboxOwner) {
    return this.client.getContainer(`uwork-sbx-${owner.id}`);
  }
  private async owned(owner: SandboxOwner) {
    let info: Docker.ContainerInspectInfo;
    try {
      info = await this.container(owner).inspect();
    } catch (error) {
      if (status(error, 404)) return null;
      fail(503, "SANDBOX_UNAVAILABLE", "沙箱服务不可达");
    }
    if (
      info.Config.Labels?.[OWNER_LABEL] !== owner.ownerToken ||
      info.Config.Labels?.[RUNTIME_LABEL] !== owner.id ||
      info.Config.Labels?.[MANAGED_LABEL] !== "uwork-backend"
    )
      fail(403, "SANDBOX_OWNER_MISMATCH", "沙箱归属校验失败");
    return info;
  }
  async create(owner: SandboxOwner): Promise<SandboxObservation> {
    if (!this.imageId && !(await this.health()).available)
      fail(503, "SANDBOX_UNAVAILABLE", "专用 Docker 沙箱或镜像不可用");
    const ttl = Math.max(1, Math.min(1800000, owner.expiresAt - now()));
    try {
      const container = await this.client.createContainer({
        name: `uwork-sbx-${owner.id}`,
        Image: this.imageId!,
        // The watchdog UID differs from exec, so untrusted code cannot stop its TTL timer.
        User: "999:999",
        WorkingDir: "/",
        Cmd: ["node", "-e", `setTimeout(()=>process.exit(0),${ttl})`],
        Env: ["HOME=/workspace", "NODE_ENV=production"],
        Labels: {
          [OWNER_LABEL]: owner.ownerToken,
          [RUNTIME_LABEL]: owner.id,
          [MANAGED_LABEL]: "uwork-backend",
          "uwork.tenant-id": owner.tenantId,
        },
        HostConfig: {
          ReadonlyRootfs: true,
          NetworkMode: "none",
          CapDrop: ["ALL"],
          SecurityOpt: ["no-new-privileges:true"],
          Memory: 256 * 1024 * 1024,
          MemorySwap: 256 * 1024 * 1024,
          NanoCpus: 500000000,
          PidsLimit: 64,
          Init: true,
          Tmpfs: {
            "/workspace":
              "rw,noexec,nosuid,nodev,size=134217728,uid=1000,gid=1000,mode=0700",
            "/tmp":
              "rw,noexec,nosuid,nodev,size=16777216,uid=1000,gid=1000,mode=0700",
          },
          LogConfig: { Type: "none", Config: {} },
        },
      });
      await container.start();
      const observation = await this.inspect(owner);
      if (!observation?.running)
        fail(503, "SANDBOX_START_FAILED", "沙箱启动失败");
      return observation;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      fail(503, "SANDBOX_START_FAILED", "沙箱创建失败");
    }
  }
  async inspect(owner: SandboxOwner): Promise<SandboxObservation | null> {
    const info = await this.owned(owner);
    return info
      ? {
          containerId: info.Id,
          running: info.State.Running,
          exitCode: info.State.ExitCode,
        }
      : null;
  }
  async stop(owner: SandboxOwner) {
    const info = await this.owned(owner);
    if (!info?.State.Running) return;
    try {
      await this.container(owner).kill({ signal: "SIGKILL" });
    } catch (error) {
      if (!status(error, 409) && !status(error, 404))
        fail(503, "SANDBOX_STOP_FAILED", "沙箱停止失败");
    }
  }
  async remove(owner: SandboxOwner) {
    if (!(await this.owned(owner))) return;
    await this.stop(owner);
    try {
      await this.container(owner).remove({ force: false, v: true });
    } catch (error) {
      if (!status(error, 404))
        fail(503, "SANDBOX_REMOVE_FAILED", "沙箱删除失败");
    }
  }
  async execute(
    owner: SandboxOwner,
    code: string,
    signal: AbortSignal,
  ): Promise<SandboxOutput> {
    signal.throwIfAborted();
    const info = await this.owned(owner);
    if (!info?.State.Running) fail(409, "SANDBOX_STOPPED", "沙箱未运行");
    const stdout = new PassThrough(),
      stderr = new PassThrough();
    const out: Buffer[] = [],
      err: Buffer[] = [];
    let bytes = 0,
      limited = false;
    let stopWork: Promise<void> | undefined;
    const stop = () => {
      stopWork ??= this.stop(owner);
      return stopWork;
    };
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > OUTPUT_LIMIT) {
        limited = true;
        void stop().catch(() => {});
        return;
      }
      target.push(Buffer.from(chunk));
    };
    stdout.on("data", collect(out));
    stderr.on("data", collect(err));
    const abort = () => {
      void stop().catch(() => {});
    };
    signal.addEventListener("abort", abort, { once: true });
    let stream: NodeJS.ReadWriteStream | undefined;
    try {
      signal.throwIfAborted();
      const exec = await this.container(owner).exec({
        Cmd: ["node", "--input-type=module", "-e", code],
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
        User: "1000:1000",
        WorkingDir: "/workspace",
      });
      if (signal.aborted) {
        await stop();
        signal.throwIfAborted();
      }
      stream = await exec.start({
        hijack: true,
        stdin: false,
        Detach: false,
        Tty: false,
      });
      const connection = stream as NodeJS.ReadWriteStream & {
        setTimeout?: (ms: number) => unknown;
      };
      if (typeof connection.setTimeout === "function") connection.setTimeout(0);
      this.client.modem.demuxStream(stream, stdout, stderr);
      await new Promise<void>((resolve, reject) => {
        stream!.once("end", resolve);
        stream!.once("close", resolve);
        stream!.once("error", reject);
      });
      if (stopWork) await stopWork;
      if (limited)
        fail(413, "SANDBOX_OUTPUT_LIMIT", "沙箱输出超出 128 KiB 限制");
      signal.throwIfAborted();
      const result = await exec.inspect();
      if (result.Running) fail(503, "SANDBOX_INCOMPLETE", "沙箱未返回终态");
      return {
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        exitCode: result.ExitCode ?? 1,
      };
    } catch (error) {
      if (signal.aborted) {
        await stop();
        throw error;
      }
      await stop();
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, "SANDBOX_EXECUTION_FAILED", "沙箱执行失败");
    } finally {
      signal.removeEventListener("abort", abort);
      if (stream && "destroy" in stream) (stream as PassThrough).destroy();
      stdout.destroy();
      stderr.destroy();
    }
  }
}
