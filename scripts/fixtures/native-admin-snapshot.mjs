import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const publicFile =
  /^(?:index\.html|brand\.svg|assets\/[A-Za-z0-9_.-]+\.(?:js|css|woff2))$/;
const csp =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

/** 仅为独占 Native 夹具提供已构建静态字节；业务接口仍由真实后台负责。 */
export async function copyNativeAdminSnapshot({ repository, ownedRoot }) {
  const manifestPath = join(
    repository,
    "evidence/client-experience-20261017/owned-admin-artifacts.json",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const allowedBuildRoot =
    resolve(repository, "evidence/client-experience-20261017") + sep;
  if (!resolve(manifest.outDir).startsWith(allowedBuildRoot))
    throw Error("Native admin snapshot must use the owned build");
  for (const row of manifest.sources) {
    if (digest(await readFile(join(repository, row.path))) !== row.sha256)
      throw Error(
        "Native admin source differs from the owned build: " + row.path,
      );
  }
  if (
    !Array.isArray(manifest.ownedAssets) ||
    manifest.ownedAssets.length === 0 ||
    manifest.ownedAssets.length > 100
  )
    throw Error("Native admin asset manifest is invalid");
  const target = join(ownedRoot, "admin-static");
  await mkdir(target);
  const files = new Map(),
    assets = [];
  for (const row of manifest.ownedAssets) {
    if (!publicFile.test(row.path) || files.has("/" + row.path))
      throw Error("Native admin asset path is invalid");
    const source = join(manifest.outDir, row.path),
      destination = join(target, row.path);
    const before = await readFile(source);
    if (digest(before) !== row.sha256)
      throw Error("Native admin asset changed before snapshot: " + row.path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    const bytes = await readFile(destination);
    if (digest(bytes) !== row.sha256)
      throw Error("Native admin snapshot differs: " + row.path);
    files.set("/" + row.path, bytes);
    assets.push({ path: row.path, bytes: bytes.length, sha256: row.sha256 });
  }
  if (!files.has("/index.html")) throw Error("Native admin index is missing");
  return {
    manifest: { source: manifestPath, target, verified: true, assets },
    serve(req, res) {
      const pathname = new URL(req.url ?? "/", "https://localhost").pathname;
      const path = pathname === "/" ? "/index.html" : pathname;
      const bytes = files.get(path);
      if (!bytes) return false;
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405).end();
        return true;
      }
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-content-type-options", "nosniff");
      if (path === "/index.html") res.setHeader("content-security-policy", csp);
      res.setHeader(
        "content-type",
        path.endsWith(".js")
          ? "text/javascript"
          : path.endsWith(".css")
            ? "text/css"
            : path.endsWith(".svg")
              ? "image/svg+xml"
              : path.endsWith(".woff2")
                ? "font/woff2"
                : "text/html; charset=utf-8",
      );
      res.writeHead(200).end(req.method === "HEAD" ? undefined : bytes);
      return true;
    },
  };
}
