export const sharingViewerCss = `
:root { color-scheme: light dark; --bg:#f5f7f6; --surface:#fff; --text:#243b31; --muted:#52665c; --line:#d9e2dc; --accent:#107c62; --error:#a42c37; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:16px/1.7 system-ui,-apple-system,"PingFang SC",sans-serif; }
button,a { -webkit-tap-highlight-color:transparent; }
button,.button { border:1px solid var(--line); border-radius:6px; padding:.5rem 1rem; color:var(--text); background:var(--surface); font:inherit; cursor:pointer; text-decoration:none; }
button:focus-visible,a:focus-visible,summary:focus-visible { outline:3px solid var(--accent); outline-offset:3px; }
button:disabled { cursor:wait; opacity:.6; }
.primary { color:white; background:var(--accent); border-color:var(--accent); }
[hidden] { display:none!important; }
header { border-bottom:1px solid var(--line); background:var(--surface); }
.header-inner,main { max-width:900px; margin:auto; padding:1rem 1.5rem; }
.header-inner { display:flex; align-items:center; justify-content:space-between; gap:1rem; }
.brand { font-size:1.2rem; font-weight:700; letter-spacing:-.02em; }
.badge { margin-left:.75rem; color:var(--accent); font-size:.85rem; }
.toolbar { display:flex; gap:.5rem; flex-wrap:wrap; }
main { padding-top:2rem; padding-bottom:4rem; }
.eyebrow,.meta,footer { color:var(--muted); font-size:.875rem; }
h1 { font-size:1.75rem; line-height:1.35; margin:.5rem 0; overflow-wrap:anywhere; }
h2 { font-size:1.1rem; }
.status,.auth-box { margin:1.5rem 0; padding:1rem 1.25rem; border:1px solid var(--line); border-radius:6px; background:var(--surface); }
.status p { margin:.5rem 0 0; color:var(--muted); }
.message { margin:1.25rem 0; padding:1rem 1.25rem; background:var(--surface); border:1px solid var(--line); border-radius:6px; }
.speaker { margin:0 0 .5rem; font-size:.875rem; font-weight:650; color:var(--accent); }
.body { white-space:pre-wrap; overflow-wrap:anywhere; margin:0; }
.turn { margin:2rem 0 1rem; border-top:1px solid var(--line); padding-top:1rem; font-size:.9rem; color:var(--muted); }
.files { list-style:none; padding:0; }
.files li { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:.75rem 0; border-bottom:1px solid var(--line); }
.file-name { overflow-wrap:anywhere; }
#notice { color:var(--error); min-height:1.75rem; overflow-wrap:anywhere; }
footer { margin-top:2rem; border-top:1px solid var(--line); padding-top:1rem; }
@media(max-width:480px) { .header-inner,main { padding-left:1rem; padding-right:1rem; } .header-inner { align-items:flex-start; flex-direction:column; } h1 { font-size:1.5rem; } .files li { align-items:flex-start; flex-direction:column; } }
@media(prefers-color-scheme:dark) { :root { --bg:#17221d; --surface:#202e27; --text:#e3ece6; --muted:#b3c4b9; --line:#40564a; --accent:#47c6a4; --error:#ffabb2; } .primary { color:#12231b; } }
`;

export const sharingViewerJs = `
(() => {
  "use strict";
  const root = document.querySelector('[data-testid="share-viewer"]');
  const code = root.dataset.shareCode;
  if (!/^[a-f0-9]{32}$/.test(code)) return;
  const api = '/api/client/shares/' + code;
  const el = id => document.getElementById(id);
  const content = el('conversation'), files = el('files'), notice = el('notice');
  let currentLoad, activeAttempt, loginGeneration = 0;
  class RequestError extends Error { constructor(status, code) { super(code); this.status=status; this.code=code; } }
  function node(tag, text, className) {
    const value=document.createElement(tag);
    if (text !== undefined) value.textContent=text;
    if (className) value.className=className;
    return value;
  }
  async function request(path, body, method='GET', signal) {
    const response=await fetch(path,{method:body===undefined?method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',
      headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),
      signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
    if (!response.ok) {
      const failure=await response.json().catch(()=>({}));
      throw new RequestError(response.status,failure.error?.code || 'REQUEST_FAILED');
    }
    return response;
  }
  function clear() { content.replaceChildren(); files.replaceChildren(); el('attachments').hidden=true; el('revoke').hidden=true; el('revoke-confirm').hidden=true; }
  function failure(error) {
    if (error.status===401) return ['请先登录企业账号','只有分享所属企业的已登录成员可以查看。'];
    if (error.code==='SHARING_FILES_DISABLED') return ['附件访问已关闭','请联系企业管理员确认文件分享权限。'];
    if (error.status===404 || error.status===410) return ['分享暂不可用','分享可能已撤销、已到期，或当前登录企业不匹配。'];
    if (error.status===403) return ['访问已被拒绝','请检查当前登录企业和企业分享权限。'];
    return ['暂时无法加载','请稍后重试。'];
  }
  function showStatus(title, description) {
    el('status-title').textContent=title; el('status-description').textContent=description; el('status').hidden=false;
  }
  function showRows(rows) {
    let turn=0;
    for (const row of rows) {
      if (row.kind==='turnHeader') { content.append(node('h2','对话 '+(++turn),'turn')); continue; }
      if (row.kind==='artifact') continue;
      const text=typeof row.text==='string'?row.text:typeof row.summaryText==='string'?row.summaryText:null;
      if (text===null) {
        if (row.kind==='toolCall') content.append(node('p','工具记录：'+String(row.toolName || row.name || '工具'),'meta'));
        continue;
      }
      const section=node(row.kind==='reasoning'?'details':'section',undefined,'message');
      const speaker=row.kind==='userInput'?'用户':row.kind==='reasoning'?'思考':'助手';
      section.append(node(row.kind==='reasoning'?'summary':'h2',speaker,'speaker'),node('p',text,'body'));
      content.append(section);
    }
  }
  function downloadPath(artifact) {
    const expected=api+'/artifacts/'+encodeURIComponent(artifact.artifact_id);
    const url=new URL(artifact.url);
    if (url.origin!==location.origin || url.pathname!==expected || url.search || url.hash || url.username || url.password) throw new Error('Invalid artifact URL');
    return expected+'/content';
  }
  async function download(artifact, button) {
    const controller=currentLoad;
    const isCurrent=()=>controller && currentLoad===controller && !controller.signal.aborted;
    if (!isCurrent()) return;
    button.disabled=true; notice.textContent='';
    try {
      const response=await request(downloadPath(artifact),undefined,'GET',controller.signal);
      if (!isCurrent()) return;
      const bytes=await response.arrayBuffer();
      if (!isCurrent()) return;
      if (bytes.byteLength!==artifact.size_bytes || bytes.byteLength>524288) throw new Error('Invalid artifact size');
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
      if (!isCurrent()) return;
      if (digest!==artifact.sha256) throw new Error('Invalid artifact digest');
      const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
      const link=node('a'); link.href=url; link.download=artifact.display_name; document.body.append(link); link.click(); link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
    } catch (error) { if (isCurrent()) notice.textContent=failure(error).join('。'); }
    finally { button.disabled=false; }
  }
  async function load() {
    currentLoad?.abort(); const controller=new AbortController(); currentLoad=controller;
    clear(); notice.textContent=''; el('login').hidden=true; el('logout').hidden=true;
    el('title').textContent='企业内会话分享'; el('meta').textContent='';
    root.dataset.state='loading'; showStatus('正在验证访问权限…',''); el('refresh').disabled=true;
    try {
      const response=await request(api+'/preview',undefined,'GET',controller.signal);
      const preview=await response.json();
      if (currentLoad!==controller || controller.signal.aborted) return;
      el('title').textContent=preview.share.title;
      el('meta').textContent='只读查看 · 到期时间 '+new Date(preview.share.expires_at).toLocaleString();
      showRows(preview.rows);
      for (const artifact of preview.artifacts) {
        downloadPath(artifact);
        const item=node('li'), button=node('button','下载');
        button.type='button'; button.dataset.artifactId=artifact.artifact_id;
        button.setAttribute('aria-label','下载 '+artifact.display_name);
        button.addEventListener('click',()=>download(artifact,button));
        item.append(node('span',artifact.display_name,'file-name'),button); files.append(item);
      }
      el('attachments').hidden=preview.artifacts.length===0;
      el('revoke').hidden=preview.can_revoke!==true;
      el('logout').hidden=false; el('status').hidden=true; root.dataset.state='ready';
    } catch (error) {
      if (currentLoad!==controller || controller.signal.aborted) return;
      clear(); const words=failure(error); showStatus(words[0],words[1]);
      el('login').hidden=![401,403,404,410].includes(error.status); root.dataset.state='unavailable';
    } finally { if (currentLoad===controller) el('refresh').disabled=false; }
  }
  async function stopLogin(cancel=true) {
    const generation=++loginGeneration; const attempt=activeAttempt; activeAttempt=undefined;
    el('auth-box').hidden=true; el('login').disabled=false;
    if (cancel && attempt) await request('/api/auth/wecom/attempts/'+encodeURIComponent(attempt.id)+'/cancel',{proof:attempt.proof}).catch(()=>{});
    return generation;
  }
  async function startLogin() {
    const generation=await stopLogin();
    if (generation!==loginGeneration) return;
    el('login').disabled=true; notice.textContent='';
    try {
      const context=await (await request('/api/auth/shares/'+code+'/context')).json();
      const attempt=await (await request('/api/auth/wecom/attempts',{tenantId:context.tenantId})).json();
      const url=new URL(attempt.authorizeUrl);
      if (url.origin!=='https://login.work.weixin.qq.com' || url.pathname!=='/wwlogin/sso/login' || url.username || url.password) throw new Error('Invalid login URL');
      if (generation!==loginGeneration) {
        await request('/api/auth/wecom/attempts/'+encodeURIComponent(attempt.id)+'/cancel',{proof:attempt.proof}).catch(()=>{});
        return;
      }
      activeAttempt=attempt; el('authorize').href=url.href; el('auth-box').hidden=false;
      const deadline=Math.min(attempt.expiresAt,Date.now()+300000);
      while (generation===loginGeneration && Date.now()<deadline) {
        const claim=await (await request('/api/auth/wecom/attempts/'+encodeURIComponent(attempt.id)+'/claim',{proof:attempt.proof,delivery:'cookie'})).json();
        if (generation!==loginGeneration) return;
        if (claim.status==='claimed') { await stopLogin(false); await load(); return; }
        if (!['pending','verifying','authorized'].includes(claim.status)) throw new Error('Login attempt ended');
        await new Promise(resolve=>setTimeout(resolve,1500));
      }
      if (generation===loginGeneration) throw new Error('Login expired');
    } catch (error) {
      if (generation!==loginGeneration) return;
      const stoppedGeneration=await stopLogin();
      if (stoppedGeneration!==loginGeneration) return;
      notice.textContent=error.code==='WECOM_NOT_CONFIGURED'?'当前企业尚未配置企业微信登录。':'登录未完成，请重新发起企业微信登录。';
    }
  }
  el('refresh').addEventListener('click',load);
  el('login').addEventListener('click',startLogin);
  el('cancel-login').addEventListener('click',()=>stopLogin());
  el('logout').addEventListener('click',async()=>{
    currentLoad?.abort(); clear();
    try { await request('/api/auth/logout',undefined,'POST'); await load(); }
    catch { showStatus('退出未完成','请检查连接后重新退出。'); }
  });
  el('revoke').addEventListener('click',()=>{ el('revoke-confirm').hidden=false; el('revoke-confirm-yes').focus(); });
  el('revoke-confirm-no').addEventListener('click',()=>{ el('revoke-confirm').hidden=true; el('revoke').focus(); });
  el('revoke-confirm-yes').addEventListener('click',async()=>{
    currentLoad?.abort(); clear();
    el('revoke-confirm-yes').disabled=true;
    try { await request(api,undefined,'DELETE'); el('revoke-confirm').hidden=true; await load(); }
    catch (error) { notice.textContent=failure(error).join('。'); }
    finally { el('revoke-confirm-yes').disabled=false; }
  });
  window.addEventListener('pagehide',()=>{currentLoad?.abort();loginGeneration++;activeAttempt=undefined;});
  load();
})();
`;
