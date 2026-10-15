"""Run inside browser-harness against scripts/admin-ui-fixture.ts, never production.

browser-harness <<'PY'
new_tab('http://uwork-review.localhost:3015')
exec(open('scripts/admin-collection-smoke.py').read())
PY
"""
import time
from urllib.parse import urlparse

assert urlparse(page_info()["url"]).hostname == "uwork-review.localhost"

def wait_ui(expression):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if js(expression):
            return
        time.sleep(0.1)
    raise AssertionError(expression)

# Controlled test identity only; do not inspect returned session material.
assert js("""(async()=>{const r=await fetch('/api/auth/login',{method:'POST',
headers:{'content-type':'application/json'},body:JSON.stringify({
email:'review@example.test',password:'synthetic-review-only'})});return r.ok})()""")
cdp("Page.reload", ignoreCache=True)
wait_for_load()
wait_ui("document.querySelector('nav')!==null")
js("""(()=>{
window.__reviewFetch=fetch.bind(window);window.__reviewRequests=[];
window.__reviewErrors=[];addEventListener('error',e=>window.__reviewErrors.push(e.message));
window.fetch=async(input,options)=>{
const u=new URL(String(input),location.href),page=Number(u.searchParams.get('page'));
if(u.pathname.endsWith('/assets')||u.pathname.endsWith('/runs')){
window.__reviewRequests.push(u.search);
if(u.pathname.endsWith('/assets')) await new Promise(r=>setTimeout(r,page===2?900:20));
return new Response(JSON.stringify({items:[{id:'row-'+page,name:'REVIEW_PAGE_'+page,
data:{kind:'skill'},status:'succeeded',agent_id:'controlled'}],total:100}),{status:200});}
if(/\\/runs\\/row-/.test(u.pathname)){
await new Promise(r=>setTimeout(r,400));
return new Response(JSON.stringify(u.pathname.endsWith('/tools')?[]:{id:'controlled'}),{status:200});}
if(u.pathname.endsWith('/usage/aggregates')){
return new Response(JSON.stringify(u.searchParams.get('q')==='selected'
?[{subject:'filtered-member',credits:7,requests:1}]
:[{subject:'member-a',credits:7,requests:1},{subject:'member-b',credits:11,requests:1}]),{status:200});}
return window.__reviewFetch(input,options);
};location.hash='assets';})()""")
wait_ui("document.querySelector('tbody')?.innerText.includes('REVIEW_PAGE_1')")
js("""(()=>{const next=document.querySelector('[aria-label=下一页]');
next.click();setTimeout(()=>next.click(),100)})()""")
wait_ui("document.querySelector('.pagination')?.innerText.endsWith('3')")
time.sleep(1.1)
assert "REVIEW_PAGE_3" in js("document.querySelector('tbody').innerText")

js("location.hash='runs'")
wait_ui("document.querySelector('tbody')?.innerText.includes('row-1')")
js("""(()=>{window.__reviewRequests=[];document.querySelector('tbody [aria-label=详情]').click();
setTimeout(()=>document.querySelector('[aria-label=下一页]').click(),100)})()""")
wait_ui("document.querySelector('.pagination')?.innerText.endsWith('2')")
time.sleep(1.1)
assert "row-2" in js("document.querySelector('tbody').innerText")
assert all("page=2&" in q for q in js("window.__reviewRequests"))
# Close the controlled detail modal before testing the next view.
js("document.querySelector('[aria-label=关闭]')?.click();location.hash='usage-aggregates'")
wait_ui("document.querySelector('tbody')?.innerText.includes('member-b')")
js("""(()=>{const e=document.querySelector('input[aria-label=搜索]');
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'selected');
e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('form.search').requestSubmit()})()""")
wait_ui("document.querySelector('tbody')?.innerText.includes('filtered-member')")
cdp("Emulation.setDeviceMetricsOverride", width=320, height=800, deviceScaleFactor=1, mobile=False)
assert js("document.documentElement.scrollWidth<=innerWidth")
assert js("window.__reviewErrors.length") == 0
cdp("Emulation.clearDeviceMetricsOverride")
print("PASS: response order, mutation/current-page refresh, aggregate search, 320px layout")
js("window.fetch=window.__reviewFetch")
cdp("Page.reload", ignoreCache=True)
