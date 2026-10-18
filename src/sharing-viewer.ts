import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import { z } from "zod";
import { rateLimit } from "./identity.js";
import { sharingLoginContext } from "./sharing.js";
import { sharingViewerCss, sharingViewerJs } from "./sharing-viewer-assets.js";

const codeSchema = z.string().regex(/^[a-f0-9]{32}$/u);
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

function page(code: string) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>企业内会话分享 · UWork</title><link rel="stylesheet" href="/share/assets/viewer.css"><script defer src="/share/assets/viewer.js"></script></head><body>
<header><div class="header-inner"><div><span class="brand">UWork</span><span class="badge">企业内分享</span></div><div class="toolbar"><button type="button" id="refresh">刷新</button><button type="button" id="logout" hidden>退出登录</button><button type="button" id="revoke" hidden>撤销分享</button></div></div></header>
<main data-testid="share-viewer" data-share-code="${code}" data-state="loading"><p class="eyebrow">仅同企业已登录成员可访问</p><h1 id="title">企业内会话分享</h1><p class="meta" id="meta"></p>
<section class="status" id="status" aria-live="polite"><h2 id="status-title">正在验证访问权限…</h2><p id="status-description"></p><button type="button" class="primary" id="login" hidden>企业微信登录</button></section>
<section class="auth-box" id="auth-box" aria-label="企业微信登录" hidden><p>打开企业微信完成认证，再回到此页面。页面会自动更新。</p><a class="button primary" id="authorize" target="_blank" rel="noopener noreferrer">打开企业微信认证</a> <button type="button" id="cancel-login">取消登录</button></section>
<section class="status" id="revoke-confirm" aria-label="确认撤销分享" hidden><h2>撤销此分享？</h2><p>撤销后，企业成员将无法继续查看正文和附件。</p><button type="button" id="revoke-confirm-yes">确认撤销</button> <button type="button" id="revoke-confirm-no">取消</button></section>
<p id="notice" role="alert"></p><article id="conversation" aria-label="分享的对话"></article><section id="attachments" hidden><h2>附件</h2><ul class="files" id="files"></ul></section>
<footer>此页面为只读分享，不会执行对话中的工具、脚本或附件。请按企业要求使用分享内容。</footer></main></body></html>`;
}

export function sharingViewerRoutes(app: FastifyInstance, db: Db) {
  for (const prefix of ["", "/cn"]) {
    app.get(`${prefix}/share/:code`, async (request, reply) => {
      const code = codeSchema.parse((request.params as { code: string }).code);
      return reply
        .header("content-security-policy", CSP)
        .type("text/html; charset=utf-8")
        .send(page(code));
    });
  }
  app.get("/share/assets/viewer.js", async (_request, reply) =>
    reply.type("text/javascript; charset=utf-8").send(sharingViewerJs),
  );
  app.get("/share/assets/viewer.css", async (_request, reply) =>
    reply.type("text/css; charset=utf-8").send(sharingViewerCss),
  );
  app.get("/api/auth/shares/:code/context", async (request) => {
    rateLimit(db, `share-login:${request.ip}`, 120, 60_000);
    return sharingLoginContext(
      db,
      codeSchema.parse((request.params as { code: string }).code),
    );
  });
}
