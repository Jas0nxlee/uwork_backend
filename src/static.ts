import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { fail } from "./core.js";
export function staticRoutes(app: FastifyInstance) {
  const root = fileURLToPath(new URL("../admin/dist/", import.meta.url));
  const serve = async (name: string, type: string) => {
    try {
      return { body: await readFile(`${root}${name}`), type };
    } catch {
      fail(503, "ADMIN_NOT_BUILT", "管理端尚未构建，请运行 npm run build");
    }
  };
  app.get("/", async (_req, reply) => {
    const r = await serve("index.html", "text/html; charset=utf-8");
    return reply
      .header(
        "content-security-policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      )
      .type(r.type)
      .send(r.body);
  });
  app.get("/brand.svg", async (_req, reply) => {
    const r = await serve("brand.svg", "image/svg+xml");
    return reply.type(r.type).send(r.body);
  });
  app.get("/assets/:file", async (req, reply) => {
    const { file } = req.params as { file: string };
    if (!/^[a-zA-Z0-9_.-]+\.(js|css|woff2)$/.test(file))
      fail(404, "NOT_FOUND", "文件不存在");
    const type = file.endsWith(".js")
      ? "text/javascript"
      : file.endsWith(".css")
        ? "text/css"
        : "font/woff2";
    const r = await serve(`assets/${file}`, type);
    return reply.type(r.type).send(r.body);
  });
}
